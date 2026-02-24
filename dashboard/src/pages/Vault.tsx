import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { getSecrets, getSecret, setSecret, deleteSecret } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export default function Vault() {
  const { data, error, loading, refetch } = useApi(getSecrets);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingName, setRevealingName] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleReveal(name: string) {
    if (revealed[name] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return;
    }

    setRevealingName(name);
    try {
      const result = await getSecret(name);
      setRevealed((prev) => ({ ...prev, [name]: result.value }));
    } catch (err) {
      toast.error('Failed to reveal secret', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRevealingName(null);
    }
  }

  async function handleAdd() {
    if (!newName.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      await setSecret(newName.trim(), newValue);
      toast.success(`Secret "${newName.trim()}" saved`);
      setNewName('');
      setNewValue('');
      setAddOpen(false);
      refetch();
    } catch (err) {
      toast.error('Failed to save secret', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Delete secret "${name}"? This cannot be undone.`)) return;
    try {
      await deleteSecret(name);
      toast.success(`Secret "${name}" deleted`);
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      refetch();
    } catch (err) {
      toast.error('Failed to delete secret', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCopy(name: string) {
    try {
      const value = revealed[name] !== undefined
        ? revealed[name]
        : (await getSecret(name)).value;
      await navigator.clipboard.writeText(value);
      toast.success(`Secret "${name}" copied to clipboard`);
    } catch (err) {
      toast.error('Failed to copy secret', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading secrets...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const secrets = data?.secrets ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Vault</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Secret
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      {secrets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No secrets stored.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secrets.map((name) => {
                const isRevealed = revealed[name] !== undefined;
                const displayValue = isRevealed
                  ? revealed[name]
                  : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

                return (
                  <TableRow key={name}>
                    <TableCell className="font-mono text-sm">{name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {isRevealed ? (
                        <span>{displayValue}</span>
                      ) : (
                        <span className="text-muted-foreground">{displayValue}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revealingName === name}
                          onClick={() => handleReveal(name)}
                        >
                          {revealingName === name
                            ? 'Loading...'
                            : isRevealed
                              ? 'Hide'
                              : 'Reveal'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(name)}
                          title="Copy to clipboard"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(name)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Secret dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Secret</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                placeholder="e.g. OPENAI_API_KEY"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                placeholder="Secret value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !newName.trim() || !newValue.trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
