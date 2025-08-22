import ChatInspector from 'renderer/components/chat/ChatInspector';

export default function Sidebar({ chatId }: { chatId: string }) {
  return <ChatInspector chatId={chatId} />;
}
