# NOLA - Next-generation Notepad

WYSIWYG テキスト + 画像エディタ。Word/Google Docs のように見たまま編集でき、1ファイル（.nola = ZIP）で完結する次世代メモ帳。

## インストール方法（利用者向け）

### Windows ポータブル版（推奨）

1. [Releases](https://github.com/lupinus-hiroki-sano/nola/releases) から `NOLA-0.1.0-win-portable.zip` をダウンロード
2. 任意のフォルダに解凍（例: `C:\Program Files\NOLA\` やデスクトップ）
3. `NOLA.exe` をダブルクリックで起動

> **注意**: Node.js のインストールは不要です。解凍するだけで使えます。

> **SmartScreen 警告**: 初回起動時に「Windows によって PC が保護されました」と表示される場合は、「詳細情報」→「実行」をクリックしてください（コード署名がないためです）。

### NOLA.exe のショートカット作成（任意）

- `NOLA.exe` を右クリック →「ショートカットの作成」→ デスクトップに配置すると便利です

## 開発者向けセットアップ

```bash
# 依存パッケージのインストール
npm install

# ビルド & 起動（開発用）
npm run dev

# ビルドのみ
npm run build

# 起動のみ（ビルド済み前提）
npm start

# パッケージング（release/win-unpacked/ に NOLA.exe が生成されます）
npm run dist
```

## 操作方法

### ファイル操作
| 操作 | ショートカット | 説明 |
|------|---------------|------|
| New | Ctrl+N | 新規ドキュメント |
| Open | Ctrl+O | .nola ファイルを開く |
| Save | Ctrl+S | 上書き保存（未保存なら Save As） |
| Save As | Ctrl+Shift+S | 名前を付けて保存 |

### 書式
| 操作 | ショートカット |
|------|---------------|
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Heading 1/2/3 | ツールバーボタン |
| Bullet List | ツールバーボタン |
| Numbered List | ツールバーボタン |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |

### 画像挿入
- **コピー&ペースト**: スクリーンショットやクリップボード画像を Ctrl+V で貼り付け
- **ドラッグ&ドロップ**: 画像ファイルをエディタにドラッグ&ドロップ

### ファイル関連付け
- `.nola` ファイルをダブルクリックすると NOLA で開きます
- エクスプローラー上で `.nola` ファイルに NOLA のアイコンが表示されます

## .nola ファイル仕様

拡張子 `.nola` の実体は ZIP コンテナ。以下の構造:

```
document.nola (ZIP)
├── doc.json       # Tiptap/ProseMirror JSON（編集データの正）
├── doc.md         # Markdown 変換（AI 投入用）
├── meta.json      # メタ情報（バージョン、日時、タイトル）
└── assets/        # 画像ファイル群
    ├── img_1234567890_abc123.png
    └── ...
```

### ルール
- `doc.json` 内の画像 src は常に相対パス（`assets/xxx.png`）
- 画像は base64 埋め込みせず、ファイル化して `assets/` に保存

## 技術スタック

- **Desktop**: Electron
- **Editor**: Tiptap (ProseMirror) + StarterKit + Image extension
- **ZIP create**: archiver
- **ZIP extract**: adm-zip
- **Build**: Vite
- **Packaging**: electron-builder

## ライセンス

MIT
