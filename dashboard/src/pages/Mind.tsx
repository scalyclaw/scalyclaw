import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getMindFiles, getMindFileContent, updateMindFile } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';

const EDITABLE_FILES = new Set(['SOUL.md', 'IDENTITY.md', 'USER.md']);

const MIND_ORDER = ['IDENTITY.md', 'SOUL.md', 'USER.md'];

export default function Mind() {
  const { data, error, loading, refetch } = useApi(getMindFiles);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const files = (data?.files ?? []).slice().sort((a, b) => {
    const ia = MIND_ORDER.indexOf(a);
    const ib = MIND_ORDER.indexOf(b);
    return (ia === -1 ? MIND_ORDER.length : ia) - (ib === -1 ? MIND_ORDER.length : ib);
  });

  const isEditable = selectedFile ? EDITABLE_FILES.has(selectedFile) : false;
  const dirty = isEditable && content !== null && originalContent !== null && content !== originalContent;

  // Auto-select first file on load
  useEffect(() => {
    if (files.length > 0 && selectedFile === null) {
      handleSelectFile(files[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length]);

  async function handleSelectFile(name: string) {
    setSelectedFile(name);
    setLoadingContent(true);
    setContent(null);
    setOriginalContent(null);
    try {
      const res = await getMindFileContent(name);
      setContent(res.content);
      setOriginalContent(res.content);
    } catch (err) {
      toast.error('Failed to load file content', {
        description: err instanceof Error ? err.message : String(err),
      });
      setContent(null);
      setOriginalContent(null);
    } finally {
      setLoadingContent(false);
    }
  }

  async function handleSave() {
    if (!selectedFile || content === null || !isEditable) return;
    setSaving(true);
    try {
      await updateMindFile(selectedFile, content);
      setOriginalContent(content);
      toast.success('File saved');
    } catch (err) {
      toast.error('Failed to save file', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading mind files...
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

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mind</h1>
        <div className="flex items-center gap-2">
          {selectedFile && !isEditable && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Read-only
            </span>
          )}
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      {/* File selector pills */}
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No mind files found.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {files.map((name) => (
            <Button
              key={name}
              variant={selectedFile === name ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSelectFile(name)}
            >
              {name}
              {!EDITABLE_FILES.has(name) && <Lock className="ml-1 h-3 w-3 opacity-50" />}
            </Button>
          ))}
        </div>
      )}

      {/* Content area — fills remaining height */}
      {selectedFile && (
        <div className="flex min-h-0 flex-1 flex-col rounded-md border">
          {loadingContent ? (
            <div className="p-4 text-sm text-muted-foreground">Loading content...</div>
          ) : content !== null ? (
            <textarea
              ref={textareaRef}
              className="flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              readOnly={!isEditable}
              spellCheck={false}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Failed to load content.</div>
          )}
        </div>
      )}
    </div>
  );
}
