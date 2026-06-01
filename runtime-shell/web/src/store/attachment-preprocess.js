const TEXT_DECODER = new TextDecoder('utf-8')
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.md', '.markdown', '.xlsx', '.csv'])
const SUPPORTED_IMAGE_PREFIX = 'image/'
const MAX_PDF_PAGES = 100
const MAX_XLSX_PREVIEW_ROWS = 40
const MAX_XLSX_PREVIEW_COLUMNS = 30
const MAX_XLSX_SHEETS = 30
const MIN_PDF_TEXT_LENGTH_FOR_NATIVE_PARSE = 24

let ocrWorkerPromise = null
let pdfjsPromise = null
let xlsxPromise = null
let pdfWorkerPromise = null

export async function disposeAttachmentPreprocessResources() {
  if (pdfWorkerPromise) {
    const pdfWorker = await pdfWorkerPromise.catch(() => null)
    pdfWorkerPromise = null
    pdfWorker?.terminate?.()
  }
  if (!ocrWorkerPromise) return
  const worker = await ocrWorkerPromise.catch(() => null)
  ocrWorkerPromise = null
  await worker?.terminate?.()
}

export function resetAttachmentPreprocessCache() {
  pdfjsPromise = null
  xlsxPromise = null
}

export function isSupportedAttachment(file) {
  if (file.type?.startsWith(SUPPORTED_IMAGE_PREFIX)) return true
  return SUPPORTED_EXTENSIONS.has(readFileExtension(file.name))
}

export function readSupportedAttachmentLabel(file) {
  if (file.type?.startsWith(SUPPORTED_IMAGE_PREFIX)) return '图片'
  const extension = readFileExtension(file.name)
  if (extension === '.pdf') return 'PDF'
  if (extension === '.xlsx') return 'XLSX'
  if (extension === '.csv') return 'CSV'
  if (extension === '.md' || extension === '.markdown') return 'Markdown'
  return '文件'
}

export async function preprocessAttachment(file, signal, onProgress = () => {}) {
  if (signal?.aborted) throw createCancelledError()

  if (file.type?.startsWith(SUPPORTED_IMAGE_PREFIX)) {
    onProgress({ progress: 1, message: '图片已就绪' })
    return {
      kind: 'image',
      part: {
        type: 'image',
        data: await fileToBase64(file),
        mimeType: file.type,
      },
    }
  }

  const extension = readFileExtension(file.name)
  if (extension === '.md' || extension === '.markdown') {
    onProgress({ progress: 0.4, message: '正在读取 Markdown' })
    const text = await readTextFile(file)
    onProgress({ progress: 1, message: 'Markdown 已就绪' })
    return {
      kind: 'resource',
      markdown: text,
      part: {
        type: 'resource',
        resource: {
          uri: `file://${file.name}`,
          text,
          mimeType: 'text/markdown',
        },
      },
    }
  }

  if (extension === '.csv') {
    onProgress({ progress: 0.4, message: '正在读取 CSV' })
    const text = await readTextFile(file)
    onProgress({ progress: 1, message: 'CSV 已就绪' })
    return {
      kind: 'resource',
      markdown: `# ${file.name}\n\n\`\`\`csv\n${text}\n\`\`\``,
      part: {
        type: 'resource',
        resource: {
          uri: `file://${file.name}`,
          text,
          mimeType: 'text/csv',
        },
      },
    }
  }

  if (extension === '.pdf') {
    const markdown = await extractPdfMarkdown(file, signal, onProgress)
    onProgress({ progress: 1, message: 'PDF 已完成预处理' })
    return {
      kind: 'resource',
      markdown,
      part: {
        type: 'resource',
        resource: {
          uri: `file://${file.name}`,
          text: markdown,
          mimeType: 'text/markdown',
        },
      },
    }
  }

  if (extension === '.xlsx') {
    const markdown = await extractWorkbookMarkdown(file, signal, onProgress)
    onProgress({ progress: 1, message: 'XLSX 已完成预处理' })
    return {
      kind: 'resource',
      markdown,
      part: {
        type: 'resource',
        resource: {
          uri: `file://${file.name}`,
          text: markdown,
          mimeType: 'text/markdown',
        },
      },
    }
  }

  throw new Error(`暂不支持的附件格式：${file.name}`)
}

export function createCancelledError() {
  const error = new Error('附件解析已取消')
  error.name = 'AttachmentCancelledError'
  return error
}

export function isCancelledError(error) {
  return error?.name === 'AttachmentCancelledError' || error?.name === 'AbortError'
}

export function readFileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.[^.]+$/)
  return match?.[0] || ''
}

async function readTextFile(file) {
  return TEXT_DECODER.decode(await file.arrayBuffer())
}

async function extractPdfMarkdown(file, signal, onProgress) {
  onProgress({ progress: 0.05, message: '正在读取 PDF' })
  const pdfjsLib = await loadPdfjs()
  const loadingTask = pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  })
  if (signal) {
    signal.addEventListener(
      'abort',
      () => {
        void loadingTask.destroy()
      },
      { once: true },
    )
  }
  const pdf = await loadingTask.promise
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES)
  const pages = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (signal?.aborted) throw createCancelledError()
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const nativeText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (nativeText.length >= MIN_PDF_TEXT_LENGTH_FOR_NATIVE_PARSE) {
      pages.push({
        pageNumber,
        method: 'text',
        text: nativeText,
      })
    } else {
      onProgress({
        progress: Math.min(0.15 + (pageNumber - 1) / pageCount * 0.75, 0.9),
        message: `第 ${pageNumber} 页文本不足，正在执行 OCR`,
      })
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('无法初始化 PDF OCR 画布')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: context, viewport }).promise
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('无法生成 PDF OCR 图像')
      const ocrText = await recognizeTextWithOcr(blob, signal, (ratio) => {
        onProgress({
          progress: Math.min(0.15 + ((pageNumber - 1) + ratio) / pageCount * 0.75, 0.95),
          message: `正在 OCR 第 ${pageNumber}/${pageCount} 页`,
        })
      })
      pages.push({
        pageNumber,
        method: 'ocr',
        text: ocrText.trim() || '（OCR 未提取到可读文本）',
      })
    }

    onProgress({
      progress: Math.min(0.15 + pageNumber / pageCount * 0.75, 0.95),
      message: `已完成第 ${pageNumber}/${pageCount} 页`,
    })
  }

  const ocrPageCount = pages.filter((page) => page.method === 'ocr').length
  const sections = [
    `# ${file.name}`,
    '',
    `页数：${pageCount}${pdf.numPages > MAX_PDF_PAGES ? ` / 原始 ${pdf.numPages} 页（已截断）` : ''}`,
    `OCR 页数：${ocrPageCount}`,
    '',
  ]

  pages.forEach((page) => {
    sections.push(`## 第 ${page.pageNumber} 页${page.method === 'ocr' ? '（OCR）' : ''}`)
    sections.push('')
    sections.push(page.text)
    sections.push('')
  })

  return sections.join('\n').trim()
}

async function extractWorkbookMarkdown(file, signal, onProgress) {
  onProgress({ progress: 0.08, message: '正在读取 XLSX' })
  const XLSX = await loadXlsx()
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheetNames = workbook.SheetNames.slice(0, MAX_XLSX_SHEETS)
  const sections = [`# ${file.name}`, '', `工作表数量：${workbook.SheetNames.length}`, '']
  const summaryRows = [['Sheet', 'Rows', 'Columns', 'Preview']]

  sheetNames.forEach((sheetName, sheetIndex) => {
    if (signal?.aborted) throw createCancelledError()
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })
    const rowCount = rows.length
    const columnCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    const previewRows = rows.slice(0, MAX_XLSX_PREVIEW_ROWS).map((row) =>
      (Array.isArray(row) ? row : [])
        .slice(0, MAX_XLSX_PREVIEW_COLUMNS)
        .map((cell) => String(cell ?? '').replace(/\|/g, '\\|')),
    )

    summaryRows.push([
      sheetName,
      String(rowCount),
      String(columnCount),
      rowCount > MAX_XLSX_PREVIEW_ROWS || columnCount > MAX_XLSX_PREVIEW_COLUMNS ? 'truncated' : 'full',
    ])

    sections.push(`## Sheet: ${sheetName}`)
    sections.push('')
    sections.push(`行数：${rowCount}`)
    sections.push(`列数：${columnCount}`)
    sections.push('')

    if (previewRows.length === 0) {
      sections.push('（空工作表）')
      sections.push('')
      onProgress({
        progress: Math.min(0.15 + (sheetIndex + 1) / Math.max(sheetNames.length, 1) * 0.8, 0.95),
        message: `已完成工作表 ${sheetIndex + 1}/${sheetNames.length}`,
      })
      return
    }

    const normalizedRows = normalizeTableRows(previewRows)
    const header = normalizedRows[0]
    const separator = Array.from({ length: header.length }, () => '---')
    sections.push('| ' + header.join(' | ') + ' |')
    sections.push('| ' + separator.join(' | ') + ' |')
    normalizedRows.slice(1).forEach((row) => {
      sections.push('| ' + row.join(' | ') + ' |')
    })
    if (rowCount > MAX_XLSX_PREVIEW_ROWS || columnCount > MAX_XLSX_PREVIEW_COLUMNS) {
      sections.push('')
      sections.push(`（已截断，仅展示前 ${MAX_XLSX_PREVIEW_ROWS} 行、前 ${MAX_XLSX_PREVIEW_COLUMNS} 列）`)
    }
    sections.push('')

    onProgress({
      progress: Math.min(0.15 + (sheetIndex + 1) / Math.max(sheetNames.length, 1) * 0.8, 0.95),
      message: `已完成工作表 ${sheetIndex + 1}/${sheetNames.length}`,
    })
  })

  sections.splice(2, 0, renderMarkdownTable(summaryRows), '')
  if (workbook.SheetNames.length > MAX_XLSX_SHEETS) {
    sections.splice(4, 0, `仅解析前 ${MAX_XLSX_SHEETS} 个工作表，剩余工作表已截断。`, '')
  }

  return sections.join('\n').trim()
}

function normalizeTableRows(rows) {
  const columnCount = Math.max(...rows.map((row) => row.length), 1)
  return rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || ''))
}

function renderMarkdownTable(rows) {
  const normalizedRows = normalizeTableRows(rows)
  const header = normalizedRows[0]
  const separator = Array.from({ length: header.length }, () => '---')
  return [
    '| ' + header.join(' | ') + ' |',
    '| ' + separator.join(' | ') + ' |',
    ...normalizedRows.slice(1).map((row) => '| ' + row.join(' | ') + ' |'),
  ].join('\n')
}

async function recognizeTextWithOcr(blob, signal, onProgress) {
  const worker = await getOcrWorker()
  if (signal?.aborted) throw createCancelledError()
  let aborted = false
  const handleAbort = async () => {
    aborted = true
    await disposeAttachmentPreprocessResources().catch(() => undefined)
  }
  signal?.addEventListener('abort', handleAbort, { once: true })
  try {
    const result = await worker.recognize(blob, {}, {
      logger: (message) => {
        if (message.status === 'recognizing text' && typeof message.progress === 'number') {
          onProgress(message.progress)
        }
      },
    })
    if (aborted || signal?.aborted) throw createCancelledError()
    return result.data.text || ''
  } finally {
    signal?.removeEventListener('abort', handleAbort)
  }
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('eng+chi_sim')
      return worker
    })()
  }
  return ocrWorkerPromise
}

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      getPdfWorker(),
    ]).then(([module, worker]) => {
      module.GlobalWorkerOptions.workerPort = worker
      return module
    })
  }
  return pdfjsPromise
}

async function loadXlsx() {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx')
  }
  return xlsxPromise
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function getPdfWorker() {
  if (!pdfWorkerPromise) {
    pdfWorkerPromise = import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker').then((module) => {
      const PdfWorker = module.default
      return new PdfWorker()
    })
  }
  return pdfWorkerPromise
}
