import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Clock, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { usePersistentState } from '@/hooks/usePersistentState';
import { copyToClipboard } from '@/lib/clipboard';

export function UnixTimeConverter() {
  const [timestamp, setTimestamp] = usePersistentState('devtool:unixTime:timestamp', '');
  const [dateTime, setDateTime] = usePersistentState('devtool:unixTime:dateTime', '');
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timestampToDate = useMemo(() => {
    if (!timestamp) return '';
    try {
      const ts = parseInt(timestamp);
      if (isNaN(ts)) return 'Invalid timestamp';
      const date = new Date(ts * (timestamp.length === 10 ? 1000 : 1));
      return format(date, 'yyyy-MM-dd HH:mm:ss');
    } catch {
      return 'Invalid timestamp';
    }
  }, [timestamp]);

  const dateToTimestamp = useMemo(() => {
    if (!dateTime) return '';
    try {
      const date = new Date(dateTime);
      if (isNaN(date.getTime())) return 'Invalid date';
      return Math.floor(date.getTime() / 1000).toString();
    } catch {
      return 'Invalid date';
    }
  }, [dateTime]);

  const useNow = () => {
    const now = Math.floor(Date.now() / 1000);
    setTimestamp(now.toString());
    setDateTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Unix Timestamp Converter
        </CardTitle>
        <CardDescription>Convert between Unix timestamps and human-readable dates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">Current Time</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-lg">{Math.floor(currentTime / 1000)}</span>
            <Button onClick={useNow} size="sm">
              Use Now
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{format(currentTime, 'PPpp')}</p>
        </div>

        <div className="space-y-2">
          <Label>Unix Timestamp → Date</Label>
          <div className="flex gap-2">
            <Input
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              placeholder="1234567890"
              type="number"
            />
            <Button onClick={() => copyToClipboard(timestamp)} size="icon" variant="outline" disabled={!timestamp}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Supports seconds (10 digits) and milliseconds (13 digits)</p>
          {timestampToDate && (
            <div className="flex gap-2">
              <Input value={timestampToDate} readOnly className="font-mono" />
              <Button onClick={() => copyToClipboard(timestampToDate)} size="icon" variant="outline">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Date → Unix Timestamp</Label>
          <Input
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            placeholder="2024-01-01T12:00"
            type="datetime-local"
          />
          {dateToTimestamp && (
            <div className="flex gap-2">
              <Input value={dateToTimestamp} readOnly className="font-mono" />
              <Button onClick={() => copyToClipboard(dateToTimestamp)} size="icon" variant="outline">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
