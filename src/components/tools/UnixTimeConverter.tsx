import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Clock, Copy } from 'lucide-react';
import { format } from 'date-fns';

export function UnixTimeConverter() {
  const [timestamp, setTimestamp] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const timestampToDate = () => {
    try {
      const ts = parseInt(timestamp);
      const date = new Date(ts * (timestamp.length === 10 ? 1000 : 1));
      setDateTime(format(date, 'yyyy-MM-dd HH:mm:ss'));
    } catch (error) {
      setDateTime('Invalid timestamp');
    }
  };

  const dateToTimestamp = () => {
    try {
      const date = new Date(dateTime);
      setTimestamp(Math.floor(date.getTime() / 1000).toString());
    } catch (error) {
      setTimestamp('Invalid date');
    }
  };

  const useNow = () => {
    const now = Math.floor(Date.now() / 1000);
    setTimestamp(now.toString());
    setDateTime(format(new Date(), 'yyyy-MM-dd HH:mm:ss'));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unix Timestamp Converter</CardTitle>
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
          <Label>Unix Timestamp</Label>
          <div className="flex gap-2">
            <Input
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              placeholder="1234567890"
              type="number"
            />
            <Button onClick={timestampToDate}>Convert</Button>
            <Button onClick={() => copyToClipboard(timestamp)} size="icon" variant="outline">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Supports both seconds (10 digits) and milliseconds (13 digits)</p>
        </div>

        <div className="space-y-2">
          <Label>Date & Time</Label>
          <div className="flex gap-2">
            <Input
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              placeholder="2024-01-01 12:00:00"
              type="datetime-local"
            />
            <Button onClick={dateToTimestamp} variant="outline">
              Convert
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
