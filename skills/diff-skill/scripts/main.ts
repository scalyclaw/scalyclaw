import * as Diff from "diff";

try {
  const data = await Bun.stdin.json();
  const oldText: string = data.old_text;
  const newText: string = data.new_text;
  const contextLines: number = data.context_lines ?? 3;

  if (oldText === undefined || oldText === null) {
    throw new Error("Missing required parameter: old_text");
  }
  if (newText === undefined || newText === null) {
    throw new Error("Missing required parameter: new_text");
  }

  console.error(`Comparing texts: old(${oldText.length} chars) vs new(${newText.length} chars)`);

  const unifiedDiff = Diff.createPatch("text", oldText, newText, "original", "modified", {
    context: contextLines,
  });

  const structuredChanges = Diff.diffLines(oldText, newText);
  let changeCount = 0;
  for (const part of structuredChanges) {
    if (part.added || part.removed) {
      changeCount++;
    }
  }

  const result = {
    diff: unifiedDiff,
    changes: changeCount,
    additions: structuredChanges.filter((p) => p.added).reduce((sum, p) => sum + (p.count || 0), 0),
    deletions: structuredChanges.filter((p) => p.removed).reduce((sum, p) => sum + (p.count || 0), 0),
  };

  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
