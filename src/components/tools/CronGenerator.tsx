import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';

export function CronGenerator() {
  const [minute, setMinute] = useState('*');
  const [hour, setHour] = useState('*');
  const [dayOfMonth, setDayOfMonth] = useState('*');
  const [month, setMonth] = useState('*');
  const [dayOfWeek, setDayOfWeek] = useState('*');

  const cronExpression = `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(cronExpression);
  };

  const presets = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every day at midnight', value: '0 0 * * *' },
    { label: 'Every Monday at 9am', value: '0 9 * * 1' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
  ];

  const applyPreset = (preset: string) => {
    const parts = preset.split(' ');
    setMinute(parts[0]);
    setHour(parts[1]);
    setDayOfMonth(parts[2]);
    setMonth(parts[3]);
    setDayOfWeek(parts[4]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cron Expression Generator</CardTitle>
          <CardDescription>Generate cron expressions for scheduling tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Minute</Label>
              <Input value={minute} onChange={(e) => setMinute(e.target.value)} placeholder="*" />
              <p className="text-xs text-muted-foreground">0-59</p>
            </div>
            <div className="space-y-2">
              <Label>Hour</Label>
              <Input value={hour} onChange={(e) => setHour(e.target.value)} placeholder="*" />
              <p className="text-xs text-muted-foreground">0-23</p>
            </div>
            <div className="space-y-2">
              <Label>Day of Month</Label>
              <Input value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} placeholder="*" />
              <p className="text-xs text-muted-foreground">1-31</p>
            </div>
            <div className="space-y-2">
              <Label>Month</Label>
              <Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="*" />
              <p className="text-xs text-muted-foreground">1-12</p>
            </div>
            <div className="space-y-2">
              <Label>Day of Week</Label>
              <Input value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} placeholder="*" />
              <p className="text-xs text-muted-foreground">0-6</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Quick Presets</Label>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Button key={preset.value} variant="outline" size="sm" onClick={() => applyPreset(preset.value)}>
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Generated Expression</Label>
            <div className="flex gap-2">
              <Input value={cronExpression} readOnly className="font-mono" />
              <Button onClick={copyToClipboard} size="icon" variant="outline">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
