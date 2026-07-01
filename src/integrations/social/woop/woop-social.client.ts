import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type WoopRequestInit = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

@Injectable()
export class WoopSocialClient {
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('woopSocial.apiKey')?.trim());
  }

  private apiKey(): string {
    const key = this.config.get<string>('woopSocial.apiKey')?.trim();
    if (!key) {
      throw new ServiceUnavailableException('WOOP_SOCIAL_API_KEY is not configured.');
    }
    return key;
  }

  private baseUrl(): string {
    return (
      this.config.get<string>('woopSocial.baseUrl')?.trim() ??
      'https://api.woopsocial.com/v1'
    ).replace(/\/+$/, '');
  }

  async request<T>(path: string, init: WoopRequestInit = {}): Promise<T> {
    const url = `${this.baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey()}`,
      Accept: 'application/json',
      ...init.headers,
    };
    if (init.body != null && !headers['Content-Type'] && !(init.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (err) {
      throw new BadGatewayException(
        `Woop Social API unreachable: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!res.ok) {
      const message =
        payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        typeof (payload as { message: unknown }).message === 'string'
          ? (payload as { message: string }).message
          : `Woop Social API error (${res.status})`;
      throw new BadGatewayException(message);
    }

    return payload as T;
  }

  get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    let url = path;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += (path.includes('?') ? '&' : '?') + qs;
    }
    return this.request<T>(url, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  delete(path: string): Promise<void> {
    return this.request<void>(path, { method: 'DELETE' });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  async postFormData<T>(
    path: string,
    formData: FormData,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    let url = path.startsWith('/') ? path : `/${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') params.set(k, v);
      }
      const qs = params.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    return this.request<T>(url, { method: 'POST', body: formData });
  }
}
