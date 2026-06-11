import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileText } from 'lucide-react';

export function TextCounter() {
  const [text, setText] = useState('');

  const stats = useMemo(() => {
    if (!text) {
      return {
        characters: 0,
        charactersNoSpaces: 0,
        words: 0,
        lines: 0,
        paragraphs: 0,
        sentences: 0,
        readingTime: 0,
      };
    }

    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;

    // Word count - split by whitespace and filter empty strings
    const words = text.trim().split(/\s+/).filter(word => word.length > 0).length;

    // Line count - split by newlines
    const lines = text.split('\n').length;

    // Paragraph count - split by double newlines or more
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

    // Sentence count - split by sentence terminators
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;

    // Reading time estimate (avg 200 words per minute)
    const readingTime = Math.ceil(words / 200);

    return {
      characters,
      charactersNoSpaces,
      words,
      lines,
      paragraphs,
      sentences,
      readingTime,
    };
  }, [text]);

  const StatCard = ({ label, value, color = 'text-foreground' }: { label: string; value: number | string; color?: string }) => (
    <div className="flex flex-col items-center justify-center p-4 rounded-lg border bg-card">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Word & Character Counter
          </CardTitle>
          <CardDescription>Count words, characters, lines, and more</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Text Input</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste your text here..."
              className="min-h-[300px] font-mono text-sm resize-y"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard label="Characters" value={stats.characters} color="text-blue-600 dark:text-blue-400" />
        <StatCard label="Characters (no spaces)" value={stats.charactersNoSpaces} color="text-purple-600 dark:text-purple-400" />
        <StatCard label="Words" value={stats.words} color="text-green-600 dark:text-green-400" />
        <StatCard label="Lines" value={stats.lines} color="text-orange-600 dark:text-orange-400" />
        <StatCard label="Paragraphs" value={stats.paragraphs} color="text-pink-600 dark:text-pink-400" />
        <StatCard label="Sentences" value={stats.sentences} color="text-cyan-600 dark:text-cyan-400" />
        <StatCard label="Reading Time" value={`${stats.readingTime} min`} color="text-indigo-600 dark:text-indigo-400" />
        <StatCard
          label="Avg Word Length"
          value={stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(1) : 0}
          color="text-teal-600 dark:text-teal-400"
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">Text Details</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Total characters: <span className="font-mono text-foreground">{stats.characters}</span></li>
                <li>• Without spaces: <span className="font-mono text-foreground">{stats.charactersNoSpaces}</span></li>
                <li>• Spaces: <span className="font-mono text-foreground">{stats.characters - stats.charactersNoSpaces}</span></li>
                <li>• Average chars per word: <span className="font-mono text-foreground">{stats.words > 0 ? (stats.charactersNoSpaces / stats.words).toFixed(2) : 0}</span></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Structure</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Words per sentence: <span className="font-mono text-foreground">{stats.sentences > 0 ? (stats.words / stats.sentences).toFixed(1) : 0}</span></li>
                <li>• Sentences per paragraph: <span className="font-mono text-foreground">{stats.paragraphs > 0 ? (stats.sentences / stats.paragraphs).toFixed(1) : 0}</span></li>
                <li>• Lines per paragraph: <span className="font-mono text-foreground">{stats.paragraphs > 0 ? (stats.lines / stats.paragraphs).toFixed(1) : 0}</span></li>
                <li>• Reading time (200 wpm): <span className="font-mono text-foreground">{stats.readingTime} {stats.readingTime === 1 ? 'minute' : 'minutes'}</span></li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
