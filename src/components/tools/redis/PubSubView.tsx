import { useEffect, useRef, useState } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { Radio, Play, Square, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { ViewHeader } from '@/components/ui/view-header';
import { Field } from '@/components/ui/tool-section';
import { Spinner } from '@/components/ui/spinner';
import type { RedisConnection, PubSubMessage } from './types';
import { redisApi } from './types';

interface PubSubViewProps {
  conn: RedisConnection;
}

// Bounded so a chatty channel doesn't grow the DOM/memory without limit —
// same idea as consumerStore's MAX_MESSAGES for Kafka/RabbitMQ live views.
const MAX_MESSAGES = 500;

function parseTargets(input: string): string[] {
  return input.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

interface ReceivedMessage extends PubSubMessage {
  id: number;
  at: number;
}

let nextId = 1;

export function PubSubView({ conn }: PubSubViewProps) {
  const [channelsInput, setChannelsInput] = useState('');
  const [patternsInput, setPatternsInput] = useState('');
  const [subscription, setSubscription] = useState<{ id: string; channels: string[]; patterns: string[] } | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);

  const [pubChannel, setPubChannel] = useState('');
  const [pubMessage, setPubMessage] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // The view unmounts on nav-away (switching to another Redis view, or
  // disconnecting) — this stops the backend subscription so it doesn't keep
  // running (and pushing messages nobody reads) after the user leaves.
  const subscriptionIdRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (subscriptionIdRef.current) redisApi.pubsubUnsubscribe(subscriptionIdRef.current).catch(() => {});
  }, []);

  const subscribe = async () => {
    const channels = parseTargets(channelsInput);
    const patterns = parseTargets(patternsInput);
    if (channels.length === 0 && patterns.length === 0) {
      setError('Provide at least one channel or pattern');
      return;
    }
    setSubscribing(true);
    setError(null);
    const ch = new Channel<PubSubMessage>();
    ch.onmessage = (msg) => {
      setMessages((prev) => {
        const next = [{ ...msg, id: nextId++, at: Date.now() }, ...prev];
        if (next.length > MAX_MESSAGES) next.length = MAX_MESSAGES;
        return next;
      });
    };
    try {
      const id = await redisApi.pubsubSubscribe(conn.id, channels, patterns, ch);
      subscriptionIdRef.current = id;
      setSubscription({ id, channels, patterns });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSubscribing(false);
    }
  };

  const stop = async () => {
    const id = subscriptionIdRef.current;
    subscriptionIdRef.current = null;
    setSubscription(null);
    if (id) { try { await redisApi.pubsubUnsubscribe(id); } catch { /* already gone */ } }
  };

  const publish = async () => {
    if (!pubChannel.trim()) { setPublishError('Channel is required'); return; }
    setPublishing(true);
    setPublishError(null);
    try {
      await redisApi.publish(conn.id, pubChannel.trim(), pubMessage);
    } catch (e) {
      setPublishError(String(e instanceof Error ? e.message : e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Radio}
        title="Pub/Sub"
        subtitle={subscription ? `Listening on ${subscription.channels.length + subscription.patterns.length} target(s)` : 'Not subscribed'}
        actions={messages.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setMessages([])}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear</Button>
        ) : undefined}
      />

      <div className="px-5 pt-3 shrink-0 space-y-2">
        {!subscription ? (
          <div className="flex items-end gap-2">
            <Field label="Channels" hint="Comma-separated exact channel names." className="flex-1">
              <Input value={channelsInput} onChange={(e) => setChannelsInput(e.target.value)} placeholder="news, alerts" className="font-mono text-sm" />
            </Field>
            <Field label="Patterns" hint="Glob patterns, e.g. news.*" className="flex-1">
              <Input value={patternsInput} onChange={(e) => setPatternsInput(e.target.value)} placeholder="news.*" className="font-mono text-sm" />
            </Field>
            <Button onClick={subscribe} disabled={subscribing}>
              {subscribing ? <Spinner size="sm" className="mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
              {subscribing ? 'Subscribing…' : 'Subscribe'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="text-xs font-mono truncate">
              {subscription.channels.map((c) => <span key={`c:${c}`} className="mr-2 text-fg-mute">#{c}</span>)}
              {subscription.patterns.map((p) => <span key={`p:${p}`} className="mr-2 text-fg-mute">~{p}</span>)}
            </div>
            <Button variant="outline" size="sm" onClick={stop}><Square className="h-3.5 w-3.5 mr-1.5" /> Stop</Button>
          </div>
        )}
        {error && <Callout tone="error" size="sm">{error}</Callout>}
      </div>

      <div className="tool-scrollable px-5 py-3 font-mono text-xs space-y-2">
        {messages.length === 0 && (
          <p className="text-fg-mute">{subscription ? 'Waiting for messages…' : 'Subscribe to a channel or pattern to see live messages here.'}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="rounded-md border px-3 py-2">
            <div className="flex items-center gap-2 text-fg-mute">
              <span>{new Date(m.at).toLocaleTimeString()}</span>
              <span className="text-fg">{m.channel}</span>
              {m.pattern && <span>via {m.pattern}</span>}
            </div>
            <pre className="whitespace-pre-wrap break-all mt-1 text-fg">{m.payload}</pre>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t px-5 py-3 space-y-2">
        <div className="flex items-end gap-2">
          <Field label="Publish to channel" className="flex-1">
            <Input value={pubChannel} onChange={(e) => setPubChannel(e.target.value)} placeholder="news" className="font-mono text-sm" />
          </Field>
          <Field label="Message" className="flex-[2]">
            <Input
              value={pubMessage}
              onChange={(e) => setPubMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void publish(); }}
              placeholder="Hello" className="font-mono text-sm"
            />
          </Field>
          <Button onClick={publish} disabled={publishing}>
            <Send className="h-3.5 w-3.5 mr-1.5" /> {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
        {publishError && <Callout tone="error" size="sm">{publishError}</Callout>}
      </div>
    </div>
  );
}
