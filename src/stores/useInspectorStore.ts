import { typeid } from 'typeid-js';
import { IModelCallTrace, ITraceable } from 'types/inspector';
import { create } from 'zustand';

export interface ITraceMessage {
  id: string;
  label: string;
  message: string;
  type: 'tool_call';
}

interface IInspectorStore {
  messages: { [key: string]: ITraceable[] };
  traceToolCall: (chatId: string, label: string, message: string) => void;
  traceModelCall: (
    chatId: string,
    trace: Omit<IModelCallTrace, 'id' | 'type' | 'chatId'>,
  ) => void;
  clearTrace: (chatId: string) => void;
}

const useInspectorStore = create<IInspectorStore>((set, get) => ({
  messages: {},
  traceToolCall: (chatId: string, label: string, message: string) => {
    const { messages } = get();
    const id = typeid('trace').toString();
    const traceMsg: ITraceable = { id, label, message, type: 'tool_call' };
    if (!messages[chatId]) {
      set({ messages: { ...messages, [chatId]: [traceMsg] } });
    } else {
      set({
        messages: {
          ...messages,
          [chatId]: messages[chatId].concat([traceMsg]),
        },
      });
    }
  },
  traceModelCall: (
    chatId: string,
    trace: Omit<IModelCallTrace, 'id' | 'type' | 'chatId'>,
  ) => {
    const { messages } = get();
    const id = typeid('trace').toString();
    const traceMsg: IModelCallTrace = {
      ...trace,
      id,
      chatId,
      type: 'model_call',
    };
    if (!messages[chatId]) {
      set({ messages: { ...messages, [chatId]: [traceMsg] } });
    } else {
      set({
        messages: {
          ...messages,
          [chatId]: messages[chatId].concat([traceMsg]),
        },
      });
    }
  },
  clearTrace: (chatId: string) => {
    const { messages } = get();
    delete messages[chatId];
    set({ messages: { ...messages } });
  },
}));

export default useInspectorStore;