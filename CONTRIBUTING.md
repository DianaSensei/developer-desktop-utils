# Contributing to DevTool

## Adding a New Utility Tool

Adding a new utility is straightforward and follows a consistent pattern.

### Step 1: Create the Tool Component

Create a new file in `src/components/tools/YourTool.tsx`:

```tsx
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function YourTool() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const process = () => {
    // Your logic here
    setOutput(input.toUpperCase());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Tool Name</CardTitle>
        <CardDescription>Brief description of what this tool does</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input</Label>
          <Input 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder="Enter something"
          />
        </div>

        <Button onClick={process}>Process</Button>

        {output && (
          <div className="space-y-2">
            <Label>Output</Label>
            <Input value={output} readOnly />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### Step 2: Register the Tool

Edit `src/App.tsx` and add your tool:

```tsx
// 1. Import your tool
import { YourTool } from '@/components/tools/YourTool';
import { YourIcon } from 'lucide-react'; // Choose an appropriate icon

// 2. Add to the tools array
const tools = [
  // ... existing tools
  { 
    path: '/your-tool', 
    label: 'Your Tool', 
    icon: YourIcon, 
    component: YourTool 
  },
];
```

That's it! Your tool will automatically appear in the sidebar navigation.

## Available UI Components

The app uses shadcn/ui components. Commonly used components:

- `Button` - Buttons with various styles
- `Input` - Text inputs
- `Textarea` - Multi-line text inputs
- `Card, CardHeader, CardTitle, CardDescription, CardContent` - Card containers
- `Label` - Form labels
- `Select, SelectTrigger, SelectContent, SelectItem` - Dropdowns

See `src/components/ui/` for all available components.

## Styling

The app uses Tailwind CSS for styling. Common patterns:

```tsx
// Spacing
<div className="space-y-4">  // Vertical spacing
<div className="flex gap-2">  // Horizontal gap

// Layout
<div className="grid grid-cols-2 gap-4">  // Two columns
<div className="flex items-center justify-between">

// Colors
<div className="bg-muted">  // Background
<p className="text-muted-foreground">  // Text color

// Borders and rounding
<div className="border rounded-lg p-4">
```

## Best Practices

1. **Keep tools focused** - Each tool should do one thing well
2. **Use Card layout** - Wrap your tool in a Card component for consistency
3. **Provide feedback** - Show success/error states to users
4. **Copy buttons** - Add copy-to-clipboard for outputs when useful
5. **Placeholder text** - Use descriptive placeholders in inputs
6. **Error handling** - Always handle errors gracefully

## Example: Copy to Clipboard

```tsx
const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

<Button onClick={() => copyToClipboard(output)} size="icon" variant="ghost">
  <Copy className="h-4 w-4" />
</Button>
```

## Testing

Before submitting:

1. Test your tool with various inputs
2. Check responsive design (mobile and desktop)
3. Verify it works in both light and dark mode
4. Ensure error cases are handled
