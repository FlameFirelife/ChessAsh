import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function TutorMarkdown({ children }: { children: string }) {
  return <div className="chat-content tutor-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{children}</Markdown></div>;
}
