import Debug from 'debug';
import IChatReader, { ITool } from 'intellichat/readers/IChatReader';
import {
  IAnthropicTool,
  IChatContext,
  IChatRequestMessage,
  IChatRequestMessageContent,
  IChatRequestPayload,
  IGeminiChatRequestMessagePart,
  IGoogleTool,
  IMCPTool,
  IOpenAITool,
} from 'intellichat/types';
import OpenAI from 'providers/OpenAI';
import { IServiceProvider } from 'providers/types';
import useInspectorStore from 'stores/useInspectorStore';
import { IModelCallTrace } from 'types/inspector';
import { raiseError, stripHtmlTags } from 'utils/util';
import { isValidHttpHRL } from 'utils/validators';

const debug = Debug('5ire:intellichat:NextChatService');

export default abstract class NextCharService {
  protected updateBuffer: string = '';
  protected reasoningBuffer: string = '';
  protected lastUpdateTime: number = 0;
  protected readonly UPDATE_INTERVAL: number = 100; // 100ms
  protected currentRequestId?: string;

  name: string;
  abortController: AbortController;
  toolAbortController: AbortController | undefined = undefined;

  context: IChatContext;

  provider: IServiceProvider;

  protected abstract getReaderType(): new (
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) => IChatReader;

  protected onCompleteCallback: (result: any) => Promise<void>;

  protected onReadingCallback: (chunk: string, reasoning?: string) => void;

  protected onToolCallsCallback: (toolName: string) => void;

  protected onErrorCallback: (error: any, aborted: boolean) => void;

  protected usedToolNames: string[] = [];

  protected inputTokens: number = 0;

  protected outputTokens: number = 0;

  protected traceToolCall: (chatId: string, label: string, msg: string) => void;

  protected traceModelCall: (
    chatId: string,
    trace: Omit<IModelCallTrace, 'id' | 'type' | 'chatId'>,
  ) => void;

  protected getSystemRoleName() {
    if (this.name === OpenAI.name) {
      return 'developer';
    }
    return 'system';
  }

  constructor({
    name,
    context,
    provider,
  }: {
    name: string;
    context: IChatContext;
    provider: IServiceProvider;
  }) {
    this.name = name;
    this.provider = provider;
    this.context = context;
    this.abortController = new AbortController();
    this.traceToolCall = useInspectorStore.getState().traceToolCall;
    this.traceModelCall = useInspectorStore.getState().traceModelCall;

    this.onCompleteCallback = () => {
      throw new Error('onCompleteCallback is not set');
    };
    this.onToolCallsCallback = () => {
      throw new Error('onToolCallingCallback is not set');
    };
    this.onReadingCallback = () => {
      throw new Error('onReadingCallback is not set');
    };
    this.onErrorCallback = () => {
      throw new Error('onErrorCallback is not set');
    };
  }

  protected createReader(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): IChatReader {
    const ReaderType = this.getReaderType();
    return new ReaderType(reader);
  }

  protected abstract makeToolMessages(
    tool: ITool,
    toolResult: any,
    content?: string,
  ): IChatRequestMessage[];

  protected abstract makeTool(
    tool: IMCPTool,
  ): IOpenAITool | IAnthropicTool | IGoogleTool;

  protected abstract makePayload(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<IChatRequestPayload>;

  protected abstract makeRequest(
    messages: IChatRequestMessage[],
    msgId?: string,
  ): Promise<Response>;

  protected getModelName() {
    const model = this.context.getModel();
    return model.name;
  }

  public onComplete(callback: (result: any) => Promise<void>) {
    this.onCompleteCallback = callback;
  }

  public onReading(callback: (chunk: string, reasoning?: string) => void) {
    this.onReadingCallback = callback;
  }

  public onToolCalls(callback: (toolName: string) => void) {
    this.onToolCallsCallback = callback;
  }

  public onError(callback: (error: any, aborted: boolean) => void) {
    this.onErrorCallback = callback;
  }

  // eslint-disable-next-line class-methods-use-this
  protected onReadingError(chunk: string) {
    try {
      const { error } = JSON.parse(chunk);
      console.error(error);
    } catch (err) {
      throw new Error(`Something went wrong`);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  protected async convertPromptContent(
    content: string,
  ): Promise<
    | string
    | Partial<IChatRequestMessageContent>
    | IChatRequestMessageContent[]
    | IGeminiChatRequestMessagePart[]
  > {
    return stripHtmlTags(content);
  }

  protected async makeHttpRequest(
    url: string,
    headers: Record<string, string>,
    payload: any,
    isStream: boolean = true,
  ): Promise<Response> {
    const provider = this.context.getProvider();

    if (isValidHttpHRL(provider.proxy || '')) {
      const requestPromise = window.electron
        .request({
          url,
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          proxy: provider.proxy,
          isStream,
        })
        .then((response: any) => {
          this.currentRequestId = response.requestId;

          if (isStream && response.isStream) {
            const stream = new ReadableStream({
              start(controller) {
                // Define cleanup function before its usage
                const cleanup = () => {
                  window.electron.ipcRenderer.unsubscribe(
                    'stream-data',
                    handleData,
                  );
                  window.electron.ipcRenderer.unsubscribe(
                    'stream-end',
                    handleEnd,
                  );
                  window.electron.ipcRenderer.unsubscribe(
                    'stream-error',
                    handleError,
                  );
                };

                const handleData = (...args: unknown[]) => {
                  const [requestId, chunk] = args as [string, Uint8Array];
                  if (requestId === response.requestId) {
                    controller.enqueue(chunk);
                  }
                };

                const handleEnd = (...args: unknown[]) => {
                  const [requestId] = args as [string];
                  if (requestId === response.requestId) {
                    controller.close();
                    cleanup();
                  }
                };

                const handleError = (...args: unknown[]) => {
                  const [requestId, errorMessage] = args as [string, string];
                  if (requestId === response.requestId) {
                    controller.error(new Error(errorMessage));
                    cleanup();
                  }
                };

                window.electron.ipcRenderer.on('stream-data', handleData);
                window.electron.ipcRenderer.on('stream-end', handleEnd);
                window.electron.ipcRenderer.on('stream-error', handleError);
              },
            });

            return new Response(stream, {
              status: response.status,
              statusText: response.statusText,
              headers: new Headers(response.headers),
            });
          }
          
          // 非流响应，直接返回文本内容
          return new Response(response.text || '', {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers),
          });
        });

      const abortPromise = new Promise<never>((resolve, reject) => {
        this.abortController.signal.addEventListener('abort', async () => {
          if (this.currentRequestId) {
            await window.electron.cancelRequest(this.currentRequestId);
          }
          reject(new DOMException('Request aborted', 'AbortError'));
        });
      });

      try {
        const response = await Promise.race([requestPromise, abortPromise]);
        return response;
      } catch (error) {
        if (this.currentRequestId) {
          await window.electron.cancelRequest(this.currentRequestId);
          this.currentRequestId = undefined;
        }
        throw error;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: this.abortController.signal,
    });
    return response;
  }

  public abort() {
    this.abortController.abort();
    this.currentRequestId = undefined;
  }

  public isToolsEnabled() {
    return this.context.getModel()?.capabilities?.tools?.enabled || false;
  }

  public async chat(messages: IChatRequestMessage[], msgId?: string) {
    const chatId = this.context.getActiveChat().id;
    this.abortController = new AbortController();
    let reply = '';
    let reasoning = '';
    let signal: any = null;
    const startTime = Date.now();
    let payload: IChatRequestPayload | null = null;

    try {
      signal = this.abortController.signal;
      payload = await this.makePayload(messages, msgId);
      const response = await this.makeRequest(messages, msgId);
      debug(
        `${this.name} Start Reading:`,
        response.status,
        response.statusText,
      );
      if (response.status !== 200) {
        const contentType = response.headers.get('content-type');
        let msg;
        let json;
        if (response.status === 404) {
          msg = `${response.url} not found, verify your API base.`;
        } else if (contentType?.includes('application/json')) {
          json = await response.json();
        } else {
          msg = await response.text();
        }
        raiseError(response.status, json, msg);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        this.onErrorCallback(new Error('No reader'), false);
        return;
      }
      const chatReader = this.createReader(reader);
      const readResult = await chatReader.read({
        onError: (err: any) => {
          this.onErrorCallback(err, !!signal?.aborted);
        },
        onProgress: (replyChunk: string, reasoningChunk?: string) => {
          const now = Date.now();
          reply += replyChunk;
          reasoning += reasoningChunk || '';
          this.updateBuffer += replyChunk;
          this.reasoningBuffer += reasoningChunk || '';
          if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
            if (this.updateBuffer || this.reasoningBuffer) {
              this.onReadingCallback(this.updateBuffer, this.reasoningBuffer);
              this.updateBuffer = '';
              this.reasoningBuffer = '';
              this.lastUpdateTime = now;
            }
          }
        },
        onToolCalls: this.onToolCallsCallback,
      });

      this.traceModelCall(chatId, {
        requestPayload: payload,
        responseBody: readResult,
        latency: Date.now() - startTime,
        inputTokens: readResult.inputTokens,
        outputTokens: readResult.outputTokens,
      });

      if (this.updateBuffer || this.reasoningBuffer) {
        this.onReadingCallback(this.updateBuffer, this.reasoningBuffer);
        this.updateBuffer = '';
        this.reasoningBuffer = '';
      }
      if (readResult?.inputTokens) {
        this.inputTokens += readResult.inputTokens;
      }
      if (readResult?.outputTokens) {
        this.outputTokens += readResult.outputTokens;
      }
      if (readResult.tool) {
        const [client, name] = readResult.tool.name.split('--');
        this.traceToolCall(chatId, name, '');

        // 生成唯一的请求ID
        const toolRequestId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 监听主控制器取消事件
        const abortHandler = async () => {
          // 通知主进程取消工具调用
          await window.electron.mcp.cancelToolCall(toolRequestId);
        };

        this.abortController.signal.addEventListener('abort', abortHandler);

        try {
          const toolCallsResult = await window.electron.mcp.callTool({
            client,
            name,
            args: readResult.tool.args,
            requestId: toolRequestId,
          });

          this.abortController.signal.removeEventListener(
            'abort',
            abortHandler,
          );

          this.traceToolCall(
            chatId,
            'arguments',
            JSON.stringify(readResult.tool.args, null, 2),
          );
          if (toolCallsResult.isError) {
            const toolError =
              toolCallsResult.content.length > 0
                ? toolCallsResult.content[0]
                : { error: 'Unknown error' };
            this.traceToolCall(
              chatId,
              'error',
              JSON.stringify(toolError, null, 2),
            );
          } else {
            this.traceToolCall(
              chatId,
              'response',
              JSON.stringify(toolCallsResult, null, 2),
            );
          }
          const messagesWithTool = [
            ...messages,
            ...this.makeToolMessages(
              readResult.tool,
              toolCallsResult,
              readResult.content,
            ),
          ] as IChatRequestMessage[];
          await this.chat(messagesWithTool);
        } catch (error) {
          this.abortController.signal.removeEventListener(
            'abort',
            abortHandler,
          );
          throw error;
        }
      } else {
        await this.onCompleteCallback({
          content: reply,
          reasoning,
          inputTokens: this.inputTokens,
          outputTokens: this.outputTokens,
        });
        this.inputTokens = 0;
        this.outputTokens = 0;
      }
    } catch (error: any) {
      this.toolAbortController = undefined;
      this.onErrorCallback(error, !!signal?.aborted);
      await this.onCompleteCallback({
        content: reply,
        reasoning,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        error: {
          code: error.code || 500,
          message: error.message || error.toString(),
        },
      });
      this.inputTokens = 0;
      this.outputTokens = 0;
    }
  }
}
