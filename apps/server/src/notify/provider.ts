// The push provider sits behind this interface (BRIEF §5). Real delivery through Expo Push
// (FCM v1 / APNs) comes in Phase 4; until then everything runs against the fake below.
export interface PushMessage {
  // Expo push token of the device.
  to: string;
  title: string;
  body: string;
  // What the app needs to open the outage detail and to group by address.
  data: Record<string, unknown>;
  // Android notification channel: one per kind, plus "hitno" for urgent ones.
  channelId: string;
  // Android group key / iOS thread identifier: one thread per saved address.
  groupKey: string;
  // iOS: `timeSensitive` interruption level for urgent notifications.
  urgent: boolean;
  // Data-only: nothing is shown, the app's background task gets `data` (the alarm-book companion of
  // a change or a cancellation). Title and body are ignored.
  silent?: boolean;
}

export interface PushTicket {
  status: 'ok' | 'error';
  // Receipt id, to check delivery later.
  id?: string;
  // e.g. "DeviceNotRegistered", "MessageRateExceeded"
  error?: string;
}

export interface PushReceipt {
  status: 'ok' | 'error';
  error?: string;
}

export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  getReceipts(ids: string[]): Promise<Record<string, PushReceipt>>;
}

// For tests: records every message, can fail tokens, and can mark tokens as dead.
export class FakePushProvider implements PushProvider {
  // Visible notifications, and the data-only companions apart (the tests count them separately).
  readonly sent: PushMessage[] = [];
  readonly silentSent: PushMessage[] = [];
  // Tokens whose send fails with this error (ticket-level).
  readonly failTokens = new Map<string, string>();
  // Tokens that are accepted at send time but whose receipt says DeviceNotRegistered.
  readonly deadTokens = new Set<string>();
  private counter = 0;
  private readonly tokenOfTicket = new Map<string, string>();

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    return messages.map((m) => {
      const error = this.failTokens.get(m.to);
      if (error) return { status: 'error', error };
      (m.silent ? this.silentSent : this.sent).push(m);
      const id = `fake-ticket-${++this.counter}`;
      this.tokenOfTicket.set(id, m.to);
      return { status: 'ok', id };
    });
  }

  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    const out: Record<string, PushReceipt> = {};
    for (const id of ids) {
      const token = this.tokenOfTicket.get(id);
      out[id] =
        token && this.deadTokens.has(token)
          ? { status: 'error', error: 'DeviceNotRegistered' }
          : { status: 'ok' };
    }
    return out;
  }

  titles(): string[] {
    return this.sent.map((m) => m.title);
  }
}

// Until real delivery exists (Phase 4: Expo Push through FCM v1 / APNs), the running server logs what
// it would send instead of pretending to deliver it.
export class LogPushProvider implements PushProvider {
  private counter = 0;
  private readonly log: (message: string) => void;

  constructor(log: (message: string) => void = (m) => console.log(m)) {
    this.log = log;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    return messages.map((m) => {
      this.log(
        m.silent
          ? `[push:not-sent] ${m.to} data-only ${JSON.stringify(m.data)}`
          : `[push:not-sent] ${m.to} (${m.channelId}) ${m.title}`,
      );
      return { status: 'ok', id: `log-${++this.counter}` };
    });
  }

  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, { status: 'ok' } as PushReceipt]));
  }
}
