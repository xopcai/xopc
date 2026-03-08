/**
 * Alibaba Paraformer STT Provider
 */

import type { STTProvider, STTResult, STTOptions } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('STT:Alibaba');

export interface AlibabaConfig {
  apiKey: string;
  model?: string;
}

/**
 * Alibaba STT API Response Types
 */
interface TaskResponse {
  status_code: number;
  request_id: string;
  code?: string;
  message?: string;
  output?: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  };
}

interface TranscriptionResult {
  file_url: string;
  transcription_url: string;
  subtask_status: string;
}

interface FetchResponse {
  status_code: number;
  request_id: string;
  output?: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    results?: TranscriptionResult[];
  };
  usage?: {
    duration: number;
  };
}

interface TranscriptionDetail {
  file_url: string;
  properties: {
    audio_format: string;
    channels: number[];
    original_sampling_rate: number;
    original_duration_in_milliseconds: number;
  };
  transcripts: Array<{
    channel_id: number;
    content_duration_in_milliseconds: number;
    text: string;
    sentences: Array<{
      begin_time: number;
      end_time: number;
      text: string;
    }>;
  }>;
}

export class AlibabaProvider implements STTProvider {
  name = 'alibaba';
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';

  constructor(config: AlibabaConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'paraformer-v2';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async transcribe(audioBuffer: Buffer, options?: STTOptions): Promise<STTResult> {
    const startTime = Date.now();
    
    try {
      // Alibaba Paraformer supports: wav, mp3, wma, ogg, aac, flac
      // Convert OGG to WAV for better compatibility if needed
      const base64Audio = audioBuffer.toString('base64');
      // Use audio/ogg directly since Paraformer supports it
      const dataUrl = `data:audio/ogg;base64,${base64Audio}`;
      
      log.debug({ 
        model: this.model, 
        bufferSize: audioBuffer.length,
        language: options?.language 
      }, 'Sending to Alibaba Paraformer');

      // Step 1: Submit async task
      const taskId = await this.submitTask(dataUrl, options);
      
      // Step 2: Wait for completion
      const result = await this.waitForCompletion(taskId);
      
      const duration = (Date.now() - startTime) / 1000;
      
      log.info({ 
        provider: 'alibaba',
        duration,
        textLength: result.text?.length 
      }, 'Transcription completed');

      return {
        text: result.text,
        provider: 'alibaba',
        duration,
        language: options?.language,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? `${error.message} (${error.stack})` : String(error);
      log.error({ 
        error: errorMsg,
        bufferSize: audioBuffer.length,
        model: this.model 
      }, 'Alibaba transcription failed');
      throw new Error(`Alibaba STT failed: ${errorMsg}`);
    }
  }

  private async submitTask(audioUrl: string, options?: STTOptions): Promise<string> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          file_urls: [audioUrl],
        },
        parameters: {
          language_hint: options?.language,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to submit task: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as TaskResponse;

    if (data.code) {
      throw new Error(`API Error: ${data.code} - ${data.message}`);
    }

    if (!data.output?.task_id) {
      log.error({ response: data }, 'Alibaba STT API response missing task_id');
      throw new Error(`No task_id returned from API: ${JSON.stringify(data)}`);
    }

    log.debug({ taskId: data.output.task_id }, 'Task submitted');
    return data.output.task_id;
  }

  private async waitForCompletion(taskId: string, maxWaitMs = 60000): Promise<{ text: string }> {
    const startTime = Date.now();
    const pollInterval = 1000; // Poll every second
    const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;

    while (Date.now() - startTime < maxWaitMs) {
      const response = await fetch(statusUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch task status: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as FetchResponse;
      const status = data.output?.task_status;

      if (status === 'SUCCEEDED') {
        const result = data.output?.results?.[0];
        if (!result) {
          throw new Error('Task succeeded but no results found');
        }
        
        // Fetch the transcription JSON from the URL
        const transcriptionData = await this.fetchTranscription(result.transcription_url);
        const fullText = transcriptionData.transcripts
          .map((t) => t.text)
          .join('\n');
        
        return { text: fullText };
      }

      if (status === 'FAILED') {
        throw new Error('Task failed');
      }

      // Still pending or running, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Task did not complete within ${maxWaitMs}ms`);
  }

  private async fetchTranscription(url: string): Promise<TranscriptionDetail> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch transcription: ${response.status}`);
    }
    return response.json() as Promise<TranscriptionDetail>;
  }
}