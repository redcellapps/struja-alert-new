import { sql } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Db } from '../db/client.ts';
import type { PushProvider } from '../notify/provider.ts';

export interface AlertMessage {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
}

// Where alerts go. A sink throws when it could not deliver, so the alerts stay pending and are
// retried on the next tick.
export interface AlertSink {
  send(alerts: AlertMessage[]): Promise<void>;
}

export class LogAlertSink implements AlertSink {
  private readonly log: (message: string, extra?: Record<string, unknown>) => void;
  constructor(log: (message: string, extra?: Record<string, unknown>) => void) {
    this.log = log;
  }
  async send(alerts: AlertMessage[]): Promise<void> {
    for (const a of alerts) this.log(`ALERT ${a.kind}: ${a.message}`, { alertId: a.id });
  }
}

// For tests.
export class FakeAlertSink implements AlertSink {
  readonly batches: AlertMessage[][] = [];
  failNext = false;
  async send(alerts: AlertMessage[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('sink down');
    }
    this.batches.push(alerts);
  }
}

const subject = (alerts: AlertMessage[]) =>
  alerts.length === 1
    ? `[Struja Alert] ${alerts[0]?.kind}`
    : `[Struja Alert] ${alerts.length} alerts`;

const body = (alerts: AlertMessage[]) =>
  alerts.map((a) => `${a.kind} (${a.createdAt.slice(0, 16)}Z)\n${a.message}`).join('\n\n');

/** One email for a batch of alerts, over SMTP. */
export class EmailAlertSink implements AlertSink {
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly to: string[];

  constructor(transport: Transporter, from: string, to: string[]) {
    this.transport = transport;
    this.from = from;
    this.to = to;
  }

  static fromSmtpUrl(smtpUrl: string, from: string, to: string[]): EmailAlertSink {
    return new EmailAlertSink(nodemailer.createTransport(smtpUrl), from, to);
  }

  async send(alerts: AlertMessage[]): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: this.to,
      subject: subject(alerts),
      text: body(alerts),
    });
  }
}

/** A push notification to the admin's own device(s) through the same provider as the app's. */
export class PushAlertSink implements AlertSink {
  private readonly provider: PushProvider;
  private readonly tokens: string[];

  constructor(provider: PushProvider, tokens: string[]) {
    this.provider = provider;
    this.tokens = tokens;
  }

  async send(alerts: AlertMessage[]): Promise<void> {
    const first = alerts[0];
    if (!first) return;
    const tickets = await this.provider.send(
      this.tokens.map((to) => ({
        to,
        title:
          alerts.length === 1
            ? `Struja Alert: ${first.kind}`
            : `Struja Alert: ${alerts.length} alerts`,
        body: alerts.length === 1 ? first.message : alerts.map((a) => a.kind).join(', '),
        data: { kind: 'admin_alert', alertIds: alerts.map((a) => a.id) },
        channelId: 'admin',
        groupKey: 'admin',
        urgent: false,
      })),
    );
    if (tickets.length && tickets.every((t) => t.status === 'error')) {
      throw new Error(`admin push failed: ${tickets[0]?.error ?? 'unknown'}`);
    }
  }
}

/** Sends to every sink. Fails only when all of them failed, so one working channel is enough. */
export class MultiAlertSink implements AlertSink {
  private readonly sinks: AlertSink[];
  constructor(sinks: AlertSink[]) {
    this.sinks = sinks;
  }
  async send(alerts: AlertMessage[]): Promise<void> {
    const results = await Promise.allSettled(this.sinks.map((s) => s.send(alerts)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length === results.length && failures.length > 0) throw failures[0]?.reason;
  }
}

/**
 * Delivers the alerts that are open and not yet announced, as one batch, and marks them announced.
 * If the sink fails they stay pending and go out on the next tick.
 */
export async function deliverAlerts(db: Db, sink: AlertSink): Promise<number> {
  const rows = (
    await db.execute(sql`
      SELECT id, kind, message, created_at FROM alert
      WHERE notified_at IS NULL AND resolved_at IS NULL ORDER BY id LIMIT 50`)
  ).rows as { id: number; kind: string; message: string; created_at: string }[];
  if (!rows.length) return 0;
  await sink.send(
    rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      message: r.message,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
  await db.execute(sql`
    UPDATE alert SET notified_at = now()
    WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(rows.map((r) => Number(r.id)))}::jsonb)::int)`);
  return rows.length;
}
