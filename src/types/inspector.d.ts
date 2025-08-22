import { ITraceMessage } from 'stores/useInspectorStore';

export interface IModelCallTrace {
  id: string;
  chatId: string;
  type: 'model_call';
  requestPayload: any;
  responseBody: any;
  inputTokens?: number;
  outputTokens?: number;
  latency: number;
}

export type ITraceable = ITraceMessage | IModelCallTrace;
