import { useState, useRef } from 'react';
import { Plus, Trash2, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import { getSkills, deleteSkill, toggleSkill, uploadSkillZip, downloadSkillZip, getSkillReadme, updateSkillReadme } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

export default function Skills() {
  const { data, error, loading, refetch } = useApi(getSkills);

  // Upload state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadId, setUploadId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Readme state
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [readmeSkillId, setReadmeSkillId] = useState<string | null>(null);
  const [readmeContent, setReadmeContent] = useState('');
  const [readmeOriginal, setReadmeOriginal] = useState('');
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [readmeSaving, setReadmeSaving] = useState(false);

  // Toggle / delete loading state
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  function resetUpload() {
    setUploadId('');
    setUploadFile(null);
    setUploadError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleUpload() {
    if (!uploadId.trim()) { setUploadError('Skill ID is required'); return; }
    if (!uploadFile) { setUploadError('Please select a zip file'); return; }

    setUploading(true);
    setUploadError(null);
    try {
      await uploadSkillZip(uploadId.trim(), uploadFile);
      toast.success(`Skill "${uploadId.trim()}" uploaded`);
      setUploadOpen(false);
      resetUpload();
      refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function openReadme(id: string) {
    setReadmeSkillId(id);
    setReadmeContent('');
    setReadmeOriginal('');
    setReadmeLoading(true);
    setReadmeOpen(true);
    try {
      const res = await getSkillReadme(id);
      setReadmeContent(res.content);
      setReadmeOriginal(res.content);
    } catch (err) {
      toast.error(`Failed to load SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
      setReadmeOpen(false);
    } finally {
      setReadmeLoading(false);
    }
  }

  async function handleSaveReadme() {
    if (!readmeSkillId) return;
    setReadmeSaving(true);
    try {
      await updateSkillReadme(readmeSkillId, readmeContent);
      setReadmeOriginal(readmeContent);
      toast.success('SKILL.md saved');
      refetch();
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReadmeSaving(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    setTogglingId(id);
    try {
      await toggleSkill(id, enabled);
      toast.success(`Skill "${id}" ${enabled ? 'enabled' : 'disabled'}`);
      refetch();
    } catch (err) {
      toast.error(`Failed to toggle skill: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDownload(id: string) {
    setDownloadingId(id);
    try {
      await downloadSkillZip(id);
      toast.success(`Skill "${id}" downloaded`);
    } catch (err) {
      toast.error(`Failed to download skill: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(`Delete skill "${id}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteSkill(id);
      toast.success(`Skill "${id}" deleted`);
      refetch();
    } catch (err) {
      toast.error(`Failed to delete skill: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">Error: {error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const skills = data?.skills ?? [];
  const readmeDirty = readmeContent !== readmeOriginal;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Skills</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Upload Skill
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        </div>
      </div>

      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No skills registered.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[220px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((skill) => {
                const id = String(skill.id);
                const enabled = Boolean(skill.enabled);
                const builtin = id === 'skill-creator-agent';
                return (
                  <TableRow key={id}>
                    <TableCell className="font-mono text-sm">{id}</TableCell>
                    <TableCell>{String(skill.name ?? '')}</TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {String(skill.description ?? '-')}
                    </TableCell>
                    <TableCell>
                      {skill.language ? (
                        <Badge variant="secondary">{String(skill.language)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={enabled}
                        disabled={builtin || togglingId === id}
                        onCheckedChange={(checked) => handleToggle(id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!builtin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReadme(id)}
                            title="View / Edit SKILL.md"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!builtin && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={downloadingId === id}
                            onClick={() => handleDownload(id)}
                            title="Download as zip"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!builtin && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deletingId === id}
                            onClick={() => handleDelete(id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={(v) => { if (!v) { resetUpload(); setUploadOpen(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Skill</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Skill ID</Label>
              <Input
                value={uploadId}
                onChange={(e) => setUploadId(e.target.value)}
                placeholder="my-skill"
              />
            </div>
            <div className="space-y-2">
              <Label>Zip File</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".zip"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Zip must contain a SKILL.md file and an optional script.
              </p>
            </div>
            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetUpload(); setUploadOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadId.trim() || !uploadFile}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SKILL.md view/edit dialog */}
      <Dialog open={readmeOpen} onOpenChange={setReadmeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SKILL.md — {readmeSkillId}</DialogTitle>
          </DialogHeader>
          {readmeLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (
            <Textarea
              className="min-h-[40vh] flex-1 resize-none font-mono text-xs leading-relaxed"
              value={readmeContent}
              onChange={(e) => setReadmeContent(e.target.value)}
              spellCheck={false}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadmeOpen(false)}>
              Close
            </Button>
            <Button onClick={handleSaveReadme} disabled={readmeSaving || !readmeDirty}>
              {readmeSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
