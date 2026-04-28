import { KeyboardEvent, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { splitEntryInput } from './gatewayEgressPolicyUtils';

interface GatewayEgressEntryListEditorProps {
  label: string;
  inputLabel: string;
  placeholder: string;
  entries: string[];
  emptyState: string;
  addLabel: string;
  normalizeEntry: (value: string) => string;
  validateEntry: (value: string) => string | null;
  onChange: (entries: string[]) => void;
}

export default function GatewayEgressEntryListEditor({
  label,
  inputLabel,
  placeholder,
  entries,
  emptyState,
  addLabel,
  normalizeEntry,
  validateEntry,
  onChange,
}: GatewayEgressEntryListEditorProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const handleAdd = () => {
    const values = splitEntryInput(draft);
    if (values.length === 0) {
      return;
    }

    const normalizedValues: string[] = [];
    for (const value of values) {
      const entryError = validateEntry(value);
      if (entryError) {
        setError(entryError);
        return;
      }
      normalizedValues.push(normalizeEntry(value));
    }

    const nextEntries = [...entries];
    for (const value of normalizedValues) {
      if (!nextEntries.includes(value)) {
        nextEntries.push(value);
      }
    }

    if (nextEntries.length === entries.length) {
      setError('This entry is already present.');
      return;
    }

    onChange(nextEntries);
    setDraft('');
    setError('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    handleAdd();
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          aria-label={inputLabel}
          value={draft}
          placeholder={placeholder}
          className="h-8 text-xs"
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError('');
          }}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={addLabel}
          disabled={!draft.trim()}
          onClick={handleAdd}
        >
          <Plus data-icon="inline-start" />
        </Button>
      </div>
      <p className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
        {error || emptyState}
      </p>
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entries.map((entry) => (
            <Badge key={entry} variant="outline" className="gap-1.5 pr-1">
              <span>{entry}</span>
              <button
                type="button"
                aria-label={`Remove ${entry}`}
                className="rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => onChange(entries.filter((current) => current !== entry))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
