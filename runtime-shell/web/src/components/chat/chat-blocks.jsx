import { UserMessageBlock } from './blocks/UserMessageBlock'
import { AssistantMessageBlock } from './blocks/AssistantMessageBlock'
import { ThinkingBlock } from './blocks/ThinkingBlock'
import { ToolBlock } from './blocks/ToolBlock'
import { TodoBlock } from './blocks/TodoBlock'
import { PlanBlock } from './blocks/PlanBlock'
import { PermissionInlineBlock } from './blocks/PermissionInlineBlock'
import { StatusBlock } from './blocks/StatusBlock'
import { ErrorBlock } from './blocks/ErrorBlock'
import { QuestionInlineBlock } from './question-form'

export function ChatBlockItem({ block }) {
  switch (block.type) {
    case 'user':
      return <UserMessageBlock block={block} />
    case 'assistant':
      return <AssistantMessageBlock block={block} />
    case 'thinking':
      return <ThinkingBlock block={block} />
    case 'tool':
      return <ToolBlock block={block} />
    case 'todo':
      return <TodoBlock block={block} />
    case 'plan':
      return <PlanBlock block={block} />
    case 'permission':
      return <PermissionInlineBlock block={block} />
    case 'question':
      return <QuestionInlineBlock block={block} />
    case 'status':
      return <StatusBlock block={block} />
    case 'error':
      return <ErrorBlock block={block} />
    default:
      return null
  }
}