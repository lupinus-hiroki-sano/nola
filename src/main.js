import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

let editor;
let isDirty = false;

// ─── Image Insert Helper ───────────────────────────────
async function insertImageFromFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const src = await window.api.saveImage(bytes, ext);
    if (src && editor) {
      editor.chain().focus().setImage({ src }).run();
      markDirty();
    }
  } catch (err) {
    console.error('Failed to insert image:', err);
  }
}

// ─── Custom Extension: Image Paste & Drop ──────────────
const ImagePasteDrop = Extension.create({
  name: 'imagePasteDrop',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItem = items.find((item) =>
              item.type.startsWith('image/'),
            );
            if (!imageItem) return false;

            const file = imageItem.getAsFile();
            if (!file) return false;

            event.preventDefault();
            insertImageFromFile(file);
            return true;
          },

          handleDrop(_view, event, _slice, moved) {
            if (moved) return false;

            const files = Array.from(event.dataTransfer?.files || []);
            const imageFile = files.find((f) => f.type.startsWith('image/'));
            if (!imageFile) return false;

            event.preventDefault();
            insertImageFromFile(imageFile);
            return true;
          },
        },
      }),
    ];
  },
});

// ─── Dirty State ───────────────────────────────────────
function markDirty() {
  if (!isDirty) {
    isDirty = true;
    updateDirtyIndicator();
  }
}

function clearDirty() {
  isDirty = false;
  updateDirtyIndicator();
}

function updateDirtyIndicator() {
  const el = document.getElementById('dirty-indicator');
  el.textContent = isDirty ? '● Unsaved changes' : '';
  el.className = isDirty ? 'dirty' : '';
}

function updateFileName(name) {
  document.getElementById('file-name').textContent = name || 'Untitled';
}

// ─── Active Button State ───────────────────────────────
function updateToolbarState() {
  const setActive = (id, active) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('is-active', active);
  };

  setActive('btn-bold', editor.isActive('bold'));
  setActive('btn-italic', editor.isActive('italic'));
  setActive('btn-h1', editor.isActive('heading', { level: 1 }));
  setActive('btn-h2', editor.isActive('heading', { level: 2 }));
  setActive('btn-h3', editor.isActive('heading', { level: 3 }));
  setActive('btn-bullet', editor.isActive('bulletList'));
  setActive('btn-ordered', editor.isActive('orderedList'));
}

// ─── Menu Action Handler ───────────────────────────────
async function handleMenuAction(action) {
  switch (action) {
    case 'new': {
      if (isDirty && !confirm('Unsaved changes will be lost. Continue?')) {
        return;
      }
      const result = await window.api.newDoc();
      if (result) {
        editor.commands.setContent(result.doc);
        clearDirty();
        updateFileName('Untitled');
      }
      break;
    }

    case 'open': {
      if (isDirty && !confirm('Unsaved changes will be lost. Continue?')) {
        return;
      }
      const result = await window.api.openDoc();
      if (result) {
        editor.commands.setContent(result.doc);
        clearDirty();
        updateFileName(result.fileName);
      }
      break;
    }

    case 'save': {
      const json = editor.getJSON();
      const result = await window.api.saveNola(json);
      if (result?.success) {
        clearDirty();
        updateFileName(result.fileName);
      }
      break;
    }

    case 'save-as': {
      const json = editor.getJSON();
      const result = await window.api.saveNolaAs(json);
      if (result?.success) {
        clearDirty();
        updateFileName(result.fileName);
      }
      break;
    }

    case 'undo':
      editor.chain().focus().undo().run();
      break;

    case 'redo':
      editor.chain().focus().redo().run();
      break;
  }
}

// ─── Toolbar Setup ─────────────────────────────────────
function setupToolbar() {
  const actions = {
    'btn-bold': () => editor.chain().focus().toggleBold().run(),
    'btn-italic': () => editor.chain().focus().toggleItalic().run(),
    'btn-h1': () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    'btn-h2': () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    'btn-h3': () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    'btn-bullet': () => editor.chain().focus().toggleBulletList().run(),
    'btn-ordered': () => editor.chain().focus().toggleOrderedList().run(),
    'btn-undo': () => editor.chain().focus().undo().run(),
    'btn-redo': () => editor.chain().focus().redo().run(),
    'btn-new': () => handleMenuAction('new'),
    'btn-open': () => handleMenuAction('open'),
    'btn-save': () => handleMenuAction('save'),
    'btn-save-as': () => handleMenuAction('save-as'),
  };

  for (const [id, handler] of Object.entries(actions)) {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', handler);
  }
}

// ─── Initialize ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  editor = new Editor({
    element: document.getElementById('editor'),
    extensions: [
      StarterKit,
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      ImagePasteDrop,
    ],
    content: '<p></p>',
    onUpdate: () => {
      markDirty();
    },
    onSelectionUpdate: () => {
      updateToolbarState();
    },
    onTransaction: () => {
      updateToolbarState();
    },
  });

  setupToolbar();

  // Listen for menu actions from Electron main process
  window.api.onMenuAction(handleMenuAction);

  // Listen for file open from main process (file association / command-line)
  window.api.onLoadDocument((data) => {
    if (data && data.doc) {
      editor.commands.setContent(data.doc);
      clearDirty();
      updateFileName(data.fileName);
    }
  });

  // Fallback: document-level paste handler (captures before ProseMirror)
  // This ensures image paste works even if Electron's menu triggers paste
  document.addEventListener(
    'paste',
    (e) => {
      if (!editor) return;
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return; // Not an image — let ProseMirror handle text paste
      e.preventDefault();
      e.stopPropagation();
      const file = imageItem.getAsFile();
      if (file) insertImageFromFile(file);
    },
    true,
  ); // capture phase — fires before ProseMirror

  // Fallback: document-level drop handler
  const editorEl = document.getElementById('editor');
  editorEl.addEventListener('dragover', (e) => e.preventDefault());
  editorEl.addEventListener('drop', (e) => {
    if (!editor) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const imageFile = files.find((f) => f.type.startsWith('image/'));
    if (!imageFile) return;
    e.preventDefault();
    e.stopPropagation();
    insertImageFromFile(imageFile);
  });
});
