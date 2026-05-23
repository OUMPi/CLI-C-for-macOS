import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './App.css';

// ============================================================
// 类型
// ============================================================
interface Command {
  id: string;
  name: string;
  cmd: string;
  desc: string;
}

interface SavedPath {
  id: string;
  name: string;   // 别名（可空，空时显示 basename）
  path: string;
  desc: string;
}

interface AppData {
  version: number;
  commands: Command[];
  paths: SavedPath[];
}

interface QueueItem {
  uid: string;
  source: 'cmd' | 'path' | 'op' | 'free';
  refKey: string;
  label: string;
  fullCmd: string;
}

const AND_OP: Command = { id: 'op-and', name: '&&', cmd: '&&', desc: '逻辑与：前一条成功才执行下一条' };

const FALLBACK_COMMANDS: Command[] = [
  { id: 'mkdir',    name: 'mkdir',        cmd: 'mkdir',        desc: '创建目录（需配合参数）' },
  { id: 'cd',       name: 'cd',           cmd: 'cd',           desc: '切换目录（需配合路径）' },
  { id: 'pwd',      name: 'pwd',          cmd: 'pwd',          desc: '显示当前工作目录' },
  { id: 'open',     name: 'open .',       cmd: 'open .',       desc: '用 Finder 打开当前目录' },
  { id: 'grep',     name: 'grep',         cmd: 'grep',         desc: '文本搜索（需配合参数）' },
  { id: 'treefind', name: 'treelike find',
    cmd: "find . -print | sed -e 's;[^/]*/;|____;g;s;____|; |;g'",
    desc: '树状显示当前目录结构' },
];

// ============================================================
// 图标
// ============================================================
const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);
const IconLocation = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-7.58 8-13a8 8 0 1 0-16 0c0 5.42 8 13 8 13z" />
    <circle cx="12" cy="9" r="3" />
  </svg>
);
const IconClose = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const IconGear = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const IconBack = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconEdit = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// ============================================================
// 工具
// ============================================================
const uid = () => Math.random().toString(36).slice(2, 10);

const pathBasename = (p: string) => {
  if (!p || p === '~') return '~';
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
};

const displayPathLabel = (p: SavedPath) => p.name?.trim() || pathBasename(p.path);

// ============================================================
// 队列 chip
// ============================================================
function QueueChip({ item, onRemove }: { item: QueueItem; onRemove: (uid: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.uid });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`queue-chip queue-chip-${item.source}`}
      {...attributes}
      {...listeners}
      title={item.fullCmd}
    >
      <span className="chip-label">{item.label}</span>
      <button
        className="chip-remove"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(item.uid); }}
        aria-label="移除"
      >
        <IconClose />
      </button>
    </div>
  );
}

// ============================================================
// 命令按钮（拖到删除区 / 拖到同类型上重排）
// ============================================================
function CommandButton({ cmd, selected, onClick }: { cmd: Command; selected: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `cmd::${cmd.id}`, data: { type: 'cmd', cmdId: cmd.id } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`cmd-btn ${selected ? 'selected' : ''}`}
      onClick={onClick}
      title={cmd.desc || cmd.cmd}
      {...attributes}
      {...listeners}
    >
      {cmd.name}
    </button>
  );
}

// ============================================================
// 路径按钮（拖到删除区 / 拖到同类型上重排）
// ============================================================
function PathButton({ savedPath, selected, onClick }: { savedPath: SavedPath; selected: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `path::${savedPath.id}`, data: { type: 'path', pathId: savedPath.id } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`path-btn ${selected ? 'selected' : ''}`}
      onClick={onClick}
      title={savedPath.desc ? `${savedPath.path}\n${savedPath.desc}` : savedPath.path}
      {...attributes}
      {...listeners}
    >
      <IconLocation />
      <span className="path-btn-label">{displayPathLabel(savedPath)}</span>
    </button>
  );
}

// ============================================================
// 删除区
// ============================================================
function DeleteZone({ visible }: { visible: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: 'delete-zone' });
  return (
    <div ref={setNodeRef} className={`delete-zone ${visible ? 'visible' : ''} ${isOver ? 'over' : ''}`}>
      <IconTrash />
      <span>拖到此处删除</span>
    </div>
  );
}

// ============================================================
// 命令表单
// ============================================================
// ============================================================
// 自由输入 popover（命令板块标题行下方弹出）
// ============================================================
function FreeInputPopover({ onSubmit, onClose }: {
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="free-input-popover">
      <input
        className="free-input-field"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(text);
          else if (e.key === 'Escape') onClose();
        }}
        onBlur={onClose}
        placeholder="输入任意文本，回车入队"
      />
    </div>
  );
}

function CommandForm({ initial, onSave, onCancel }: {
  initial: Command | null;
  onSave: (c: Command) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [cmd, setCmd]   = useState(initial?.cmd ?? '');
  const [desc, setDesc] = useState(initial?.desc ?? '');
  const valid = name.trim() && cmd.trim();
  return (
    <div className="form-overlay" onClick={onCancel}>
      <div className="form-card" onClick={(e) => e.stopPropagation()}>
        <div className="form-title">{initial ? '编辑命令' : '添加命令'}</div>
        <label className="form-label">显示名</label>
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)}
               placeholder="例如：git status" autoFocus />
        <label className="form-label">命令</label>
        <input className="form-input mono" value={cmd} onChange={(e) => setCmd(e.target.value)}
               placeholder="例如：git status" />
        <label className="form-label">描述（鼠标悬停时显示）</label>
        <input className="form-input" value={desc} onChange={(e) => setDesc(e.target.value)}
               placeholder="可选" />
        <div className="form-actions">
          <button className="form-btn ghost" onClick={onCancel}>取消</button>
          <button className="form-btn primary"
                  onClick={() => valid && onSave({
                    id: initial?.id ?? uid(),
                    name: name.trim(), cmd: cmd.trim(), desc: desc.trim(),
                  })}
                  disabled={!valid}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 路径表单
// ============================================================
function PathForm({ initial, onSave, onCancel }: {
  initial: SavedPath | null;
  onSave: (p: SavedPath) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState(initial?.path ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [desc, setDesc] = useState(initial?.desc ?? '');
  const valid = path.trim();
  return (
    <div className="form-overlay" onClick={onCancel}>
      <div className="form-card" onClick={(e) => e.stopPropagation()}>
        <div className="form-title">{initial ? '编辑路径' : '添加路径'}</div>
        <label className="form-label">路径</label>
        <input className="form-input mono" value={path} onChange={(e) => setPath(e.target.value)}
               placeholder="例如：/Users/foo/Projects" autoFocus />
        <label className="form-label">别名（可选，留空显示路径末段）</label>
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)}
               placeholder="例如：工作目录" />
        <label className="form-label">描述（鼠标悬停时显示）</label>
        <input className="form-input" value={desc} onChange={(e) => setDesc(e.target.value)}
               placeholder="可选" />
        <div className="form-actions">
          <button className="form-btn ghost" onClick={onCancel}>取消</button>
          <button className="form-btn primary"
                  onClick={() => valid && onSave({
                    id: initial?.id ?? uid(),
                    name: name.trim(), path: path.trim(), desc: desc.trim(),
                  })}
                  disabled={!valid}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================
function App() {
  const [commands, setCommands] = useState<Command[]>([]);
  const [savedPaths, setSavedPaths] = useState<SavedPath[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState<{ kind: 'queue' | 'path' | 'cmd' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [freeInputOpen, setFreeInputOpen] = useState(false);
  const [cmdEditing, setCmdEditing] = useState<Command | null>(null);
  const [cmdFormOpen, setCmdFormOpen] = useState(false);
  const [pathEditing, setPathEditing] = useState<SavedPath | null>(null);
  const [pathFormOpen, setPathFormOpen] = useState(false);



  // ---- 加载 ----
  useEffect(() => {
    invoke<AppData>('load_data')
      .then((d) => {
        setCommands(d.commands?.length ? d.commands : FALLBACK_COMMANDS);
        setSavedPaths(d.paths ?? []);
        setLoaded(true);
      })
      .catch((e) => {
        console.error('加载数据失败', e);
        setCommands(FALLBACK_COMMANDS);
        setLoaded(true);
      });
  }, []);

  // ---- 自动保存 ----
  useEffect(() => {
    if (!loaded) return;
    const data: AppData = { version: 1, commands, paths: savedPaths };
    invoke('save_data', { data }).catch((e) => console.error('保存失败', e));
  }, [commands, savedPaths, loaded]);

  // ---- 队列切换 ----
  const toggleCommand = (cmd: Command) => {
    setQueue((q) => {
      const idx = q.findIndex((i) => i.source === 'cmd' && i.refKey === cmd.id);
      if (idx >= 0) return q.filter((_, i) => i !== idx);
      return [...q, { uid: uid(), source: 'cmd', refKey: cmd.id, label: cmd.name, fullCmd: cmd.cmd }];
    });
  };

  const toggleOp = () => {
    setQueue((q) => {
      const idx = q.findIndex((i) => i.source === 'op' && i.refKey === AND_OP.id);
      if (idx >= 0) return q.filter((_, i) => i !== idx);
      return [...q, { uid: uid(), source: 'op', refKey: AND_OP.id, label: AND_OP.name, fullCmd: AND_OP.cmd }];
    });
  };

  const togglePath = (sp: SavedPath) => {
    setQueue((q) => {
      const idx = q.findIndex((i) => i.source === 'path' && i.refKey === sp.id);
      if (idx >= 0) return q.filter((_, i) => i !== idx);
      return [...q, { uid: uid(), source: 'path', refKey: sp.id, label: displayPathLabel(sp), fullCmd: `"${sp.path}"` }];
    });
  };

  const removeFromQueue = (queueUid: string) => {
    setQueue((q) => q.filter((i) => i.uid !== queueUid));
  };

  // 自由输入：作为一次性 chip 入队（无 refKey，不参与按钮选中态）
  const addFreeInput = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setQueue((q) => [
      ...q,
      { uid: uid(), source: 'free', refKey: '', label: t, fullCmd: t },
    ]);
  };

  // ---- 读存路径 ----
  const fetchAndStorePath = async () => {
    try {
      const p = await invoke<string>('get_current_terminal_path');
      if (!p) { setError('未能取到 Terminal 路径'); return; }
      if (savedPaths.some((sp) => sp.path === p)) return;
      const newPath: SavedPath = { id: uid(), name: '', path: p, desc: '' };
      setSavedPaths([...savedPaths, newPath]);
    } catch (e) {
      setError(String(e));
    }
  };

  // ---- 执行 ----
  const executeQueue = async () => {
    if (queue.length === 0) return;
    const combined = queue.map((i) => i.fullCmd).join(' ');
    try {
      await invoke('execute_command', { cmd: combined });
      setQueue([]);
    } catch (e) {
      setError(String(e));
    }
  };

  // ---- 命令 CRUD ----
  const saveCommand = (c: Command) => {
    setCommands((list) => {
      const idx = list.findIndex((x) => x.id === c.id);
      if (idx < 0) return [...list, c];
      const next = list.slice();
      next[idx] = c;
      return next;
    });
    setCmdFormOpen(false);
    setCmdEditing(null);
  };

  // ---- 路径 CRUD ----
  const savePath = (p: SavedPath) => {
    setSavedPaths((list) => {
      const idx = list.findIndex((x) => x.id === p.id);
      if (idx < 0) return [...list, p];
      const next = list.slice();
      next[idx] = p;
      return next;
    });
    setPathFormOpen(false);
    setPathEditing(null);
  };

  // ---- dnd ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('path::')) setDragging({ kind: 'path' });
    else if (id.startsWith('cmd::')) setDragging({ kind: 'cmd' });
    else setDragging({ kind: 'queue' });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setDragging(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // 命令拖到删除区
    if (activeId.startsWith('cmd::') && overId === 'delete-zone') {
      const cmdId = activeId.slice('cmd::'.length);
      setCommands(commands.filter((c) => c.id !== cmdId));
      setQueue((q) => q.filter((i) => !(i.source === 'cmd' && i.refKey === cmdId)));
      return;
    }

    // 路径拖到删除区
    if (activeId.startsWith('path::') && overId === 'delete-zone') {
      const pathId = activeId.slice('path::'.length);
      setSavedPaths(savedPaths.filter((p) => p.id !== pathId));
      setQueue((q) => q.filter((i) => !(i.source === 'path' && i.refKey === pathId)));
      return;
    }

    // 命令重排
    if (activeId.startsWith('cmd::') && overId.startsWith('cmd::') && activeId !== overId) {
      const fromId = activeId.slice('cmd::'.length);
      const toId = overId.slice('cmd::'.length);
      setCommands((list) => {
        const oldIdx = list.findIndex((c) => c.id === fromId);
        const newIdx = list.findIndex((c) => c.id === toId);
        if (oldIdx < 0 || newIdx < 0) return list;
        return arrayMove(list, oldIdx, newIdx);
      });
      return;
    }

    // 路径重排
    if (activeId.startsWith('path::') && overId.startsWith('path::') && activeId !== overId) {
      const fromId = activeId.slice('path::'.length);
      const toId = overId.slice('path::'.length);
      setSavedPaths((list) => {
        const oldIdx = list.findIndex((p) => p.id === fromId);
        const newIdx = list.findIndex((p) => p.id === toId);
        if (oldIdx < 0 || newIdx < 0) return list;
        return arrayMove(list, oldIdx, newIdx);
      });
      return;
    }

    // 队列内排序
    if (!activeId.includes('::') && !overId.includes('::') &&
        overId !== 'delete-zone' && activeId !== overId) {
      setQueue((q) => {
        const oldIdx = q.findIndex((i) => i.uid === activeId);
        const newIdx = q.findIndex((i) => i.uid === overId);
        if (oldIdx < 0 || newIdx < 0) return q;
        return arrayMove(q, oldIdx, newIdx);
      });
    }
  };

  const cmdSelected = (id: string) => queue.some((i) => i.source === 'cmd' && i.refKey === id);
  const pathSelected = (id: string) => queue.some((i) => i.source === 'path' && i.refKey === id);
  const opSelected = queue.some((i) => i.source === 'op');
  const showDeleteZone = dragging?.kind === 'path' || dragging?.kind === 'cmd';

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
                onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="launcher-panel">
        {settingsOpen ? (
          <SettingsView
            commands={commands}
            paths={savedPaths}
            onClose={() => setSettingsOpen(false)}
            onAddCmd={() => { setCmdEditing(null); setCmdFormOpen(true); }}
            onEditCmd={(c) => { setCmdEditing(c); setCmdFormOpen(true); }}
            onAddPath={() => { setPathEditing(null); setPathFormOpen(true); }}
            onEditPath={(p) => { setPathEditing(p); setPathFormOpen(true); }}
          />
        ) : (
          <>
            {/* 队列预览栏（仅主界面） */}
            <div className="queue-bar">
              <div className="queue-chips-wrap">
                {queue.length === 0 ? (
                  <span className="queue-empty">点击下方按钮预选命令</span>
                ) : (
                  <SortableContext items={queue.map((i) => i.uid)} strategy={horizontalListSortingStrategy}>
                    <div className="queue-chips">
                      {queue.map((item) => (
                        <QueueChip key={item.uid} item={item} onRemove={removeFromQueue} />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </div>
              <button className={`op-btn-inline ${opSelected ? 'selected' : ''}`}
                      onClick={toggleOp} title={AND_OP.desc}>
                {AND_OP.name}
              </button>
              <button className="execute-btn-inline" onClick={executeQueue} disabled={queue.length === 0}
                      title={queue.length === 0 ? '队列为空' : `执行 ${queue.length} 个命令`}
                      aria-label="执行队列">
                <IconPlay />
                {queue.length > 0 && <span className="exec-count">{queue.length}</span>}
              </button>
            </div>

            {/* 主区域：命令上 + 路径下，各占一半，各自滚 */}
            <div className="main-area">
              {/* 命令板块 */}
              <div className="pane pane-cmd">
                <div className="pane-header">
                  <div className="pane-title">常用命令</div>
                  <div className="pane-actions">
                    <button
                      className="path-tool-btn aa-btn"
                      onClick={() => setFreeInputOpen((v) => !v)}
                      title="自由输入：临时添加一段文本到队列"
                      aria-label="自由输入"
                    >
                      Aa
                    </button>
                  </div>
                </div>
                {freeInputOpen && (
                  <FreeInputPopover
                    onSubmit={(text) => { addFreeInput(text); setFreeInputOpen(false); }}
                    onClose={() => setFreeInputOpen(false)}
                  />
                )}
                <SortableContext items={commands.map((c) => `cmd::${c.id}`)} strategy={rectSortingStrategy}>
                  <div className="cmd-grid">
                    {commands.map((c) => (
                      <CommandButton key={c.id} cmd={c} selected={cmdSelected(c.id)}
                                     onClick={() => toggleCommand(c)} />
                    ))}
                  </div>
                </SortableContext>
              </div>

              {/* 路径板块 */}
              <div className="pane pane-path">
                <div className="pane-header">
                  <div className="pane-title">常用路径</div>
                  <div className="pane-actions">
                    <button className="path-tool-btn gear-btn" onClick={() => setSettingsOpen(true)}
                            title="管理常用命令与路径" aria-label="设置">
                      <IconGear />
                    </button>
                    <button className="path-tool-btn read-store-btn" onClick={fetchAndStorePath}>
                      <IconLocation />
                      <span>读存路径</span>
                    </button>
                  </div>
                </div>
                <SortableContext items={savedPaths.map((p) => `path::${p.id}`)} strategy={rectSortingStrategy}>
                  <div className="path-list">
                    {savedPaths.length === 0 ? (
                      <div className="path-empty">点击「读存路径」捕获 Terminal 当前位置</div>
                    ) : (
                      savedPaths.map((p) => (
                        <PathButton key={p.id} savedPath={p} selected={pathSelected(p.id)}
                                    onClick={() => togglePath(p)} />
                      ))
                    )}
                  </div>
                </SortableContext>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="toast" onClick={() => setError(null)}>{error}</div>
        )}

        <DeleteZone visible={showDeleteZone} />

        {cmdFormOpen && (
          <CommandForm initial={cmdEditing} onSave={saveCommand}
                       onCancel={() => { setCmdFormOpen(false); setCmdEditing(null); }} />
        )}
        {pathFormOpen && (
          <PathForm initial={pathEditing} onSave={savePath}
                    onCancel={() => { setPathFormOpen(false); setPathEditing(null); }} />
        )}
      </div>
    </DndContext>
  );
}

// ============================================================
// 设置视图：上下两块，各占一半
// ============================================================
function SettingsView({
  commands, paths, onClose, onAddCmd, onEditCmd, onAddPath, onEditPath,
}: {
  commands: Command[];
  paths: SavedPath[];
  onClose: () => void;
  onAddCmd: () => void;
  onEditCmd: (c: Command) => void;
  onAddPath: () => void;
  onEditPath: (p: SavedPath) => void;
}) {
  return (
    <div className="settings-view">
      <div className="settings-header">
        <button className="path-tool-btn icon-only" onClick={onClose} title="返回" aria-label="返回">
          <IconBack />
        </button>
        <div className="settings-title">设置</div>
        {/* 占位，保持 title 居中 */}
        <div className="header-spacer" />
      </div>

      {/* 命令板块 */}
      <div className="settings-block block-cmd">
        <div className="block-title">常用命令</div>
        <div className="block-list">
          <button className="add-row" onClick={onAddCmd}>
            <IconPlus /><span>添加命令</span>
          </button>
          {commands.map((c) => (
            <div key={c.id} className="settings-row">
              <div className="settings-row-main">
                <div className="settings-row-name">{c.name}</div>
                <div className="settings-row-cmd">{c.cmd}</div>
                {c.desc && <div className="settings-row-desc">{c.desc}</div>}
              </div>
              <button className="row-action" onClick={() => onEditCmd(c)} title="编辑" aria-label="编辑">
                <IconEdit />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 路径板块 */}
      <div className="settings-block block-path">
        <div className="block-title">常用路径</div>
        <div className="block-list">
          <button className="add-row" onClick={onAddPath}>
            <IconPlus /><span>添加路径</span>
          </button>
          {paths.map((p) => (
            <div key={p.id} className="settings-row">
              <div className="settings-row-main">
                <div className="settings-row-name">{p.name || pathBasename(p.path)}</div>
                <div className="settings-row-cmd">{p.path}</div>
                {p.desc && <div className="settings-row-desc">{p.desc}</div>}
              </div>
              <button className="row-action" onClick={() => onEditPath(p)} title="编辑" aria-label="编辑">
                <IconEdit />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
