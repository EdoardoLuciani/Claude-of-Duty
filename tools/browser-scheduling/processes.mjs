import { execFileSync } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
export function parseStat(text) {
  const end = text.lastIndexOf(')'),
    fields = text
      .slice(end + 2)
      .trim()
      .split(/\s+/);
  return {
    pid: Number(text.slice(0, text.indexOf(' '))),
    comm: text.slice(text.indexOf('(') + 1, end),
    ppid: Number(fields[1]),
    ticks: Number(fields[11]) + Number(fields[12]),
    start: fields[19],
  };
}
export async function snapshot(root) {
  const entries = await readdir('/proc');
  const all = (
    await Promise.all(
      entries
        .filter((x) => /^\d+$/.test(x))
        .map(async (pid) => {
          try {
            return parseStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
          } catch {
            return null;
          }
        })
    )
  ).filter(Boolean);
  const selected = new Set([root]);
  let previous = 0;
  while (previous !== selected.size) {
    previous = selected.size;
    for (const p of all) if (selected.has(p.ppid)) selected.add(p.pid);
  }
  return all.filter((p) => selected.has(p.pid));
}
export function cpuDelta(before, after, frames) {
  return before.map((p) => {
    const end = after.find((e) => e.pid === p.pid && e.start === p.start);
    return {
      ...p,
      msPerFrame: end ? (((end.ticks - p.ticks) / hz) * 1000) / frames : null,
      missingAtEnd: !end,
    };
  });
}
export async function renderNodes(processes) {
  const result = [];
  for (const p of processes) {
    try {
      for (const fd of await readdir(`/proc/${p.pid}/fd`)) {
        let path;
        try {
          path = await readlink(`/proc/${p.pid}/fd/${fd}`);
        } catch {
          continue;
        }
        if (!/^\/dev\/dri\/renderD\d+$/.test(path)) continue;
        const node = path.split('/').at(-1),
          base = `/sys/class/drm/${node}/device`;
        result.push({
          pid: p.pid,
          comm: p.comm,
          node,
          vendor: (await readFile(base + '/vendor', 'utf8')).trim(),
          device: (await readFile(base + '/device', 'utf8')).trim(),
        });
      }
    } catch {
      /* process exited after sample */
    }
  }
  return result;
}
