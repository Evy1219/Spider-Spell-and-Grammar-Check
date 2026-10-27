# Spell Spider 🕷️

A proofreading spider that walks across your documents line by line. Every time its front legs reach a spelling or grammar mistake, it stops, wraps the mistake in a colored outline, and adds it to a list, until every mistake has been found.

It's a plain website (HTML, CSS and JavaScript), so it runs for free on GitHub Pages with no server and nothing to install.

## What it does

- **Upload several files at once**: `.txt`, `.md`, `.pdf` and `.docx` (Word). Drag and drop works anywhere on the page.
- **The spider walks every line** in a zig-zag, left to right and then right to left, down each page and on to the next document.
- **Mistakes are outlined the moment the spider reaches them**:
  - red for spelling
  - amber for grammar
  - blue for style and punctuation
- **Speed control** from Crawl to Zoom (10 steps), adjustable while it walks.
- **Stop at each catch** sets how long the spider pauses on every mistake (0 to 2 seconds).
- **Customize the spider**: size, color (five presets or any color), silk thread on or off, an optional catch sound.
- **Controls**: Start, Pause and Resume, Skip page, Find all now, Walk again.
- **The mistakes list** shows each one with an explanation and suggested fixes. Select one to jump to it in the document.
- **Filters** hide or show spelling, grammar or style mistakes.
- **Words to ignore** for names, game terms and slang.
- **Download report** saves every caught mistake as a `.csv` file you can open in Excel or Google Sheets.
- Remembers your settings, works on phones, and has a dark mode.

## Two ways to check

| | Online (default) | Private |
|---|---|---|
| Spelling | Very good | Good |
| Grammar | Very good | Common mistakes only (their/there, could of, a/an, repeated words, capital letters, and more) |
| Where your text goes | Sent to [LanguageTool](https://languagetool.org)'s free public API | Never leaves your browser |
| Needs internet | Yes | Only once, to download the dictionary |

If LanguageTool can't be reached, the app switches to the private checker automatically and tells you.

**About LanguageTool's free limits:** the public API allows about 20 requests and 75 KB of text per minute. Spell Spider stays under that by itself. For very long documents the spider may sit on top of a page with a "Reading ahead…" bubble while it waits for the next part to be checked. That's normal.

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `spell-spider`). Make it **Public**.
2. Select **Add file → Upload files** and drag in everything from this folder, keeping the `js` folder:
   ```
   index.html
   style.css
   README.md
   js/app.js
   js/checker.js
   js/extract.js
   js/spider.js
   ```
   Tip: unzip `spell-spider.zip`, open the folder, select everything inside it, and drag it all onto the upload page at once. GitHub keeps the `js` folder.
3. Select **Commit changes**.
4. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, then **Save**.
5. Wait a minute or two. Your site appears at `https://YOUR-USERNAME.github.io/spell-spider/`.

### Running it on your own computer

Opening `index.html` by double-clicking works in most browsers. If PDFs or the private checker don't load that way, run a tiny local server from the folder instead:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## How it works

| File | Job |
|---|---|
| `index.html` | Page layout: top bar, documents and settings, the pages, the mistakes list |
| `style.css` | All the styling, including dark mode and phone layout |
| `js/spider.js` | Draws the spider as SVG and animates its eight legs with a real alternating spider gait |
| `js/extract.js` | Reads files. PDFs use PDF.js and get their lines and paragraphs rebuilt. Word files use mammoth.js. Long text files are split into pages |
| `js/checker.js` | The two checkers: LanguageTool (online, rate-limited) and the private one (Hunspell dictionary through Typo.js plus about 30 grammar rules) |
| `js/app.js` | Ties it together: renders pages, measures every line of text, walks the spider along them, and catches mistakes when its legs reach them |

Each document is checked in the background as soon as you add it. The mistakes are already marked in the page but kept invisible. As the spider walks, the app measures where each line and each mistake sits on screen, and the instant the spider's front legs reach a mistake it becomes visible with a lasso animation.

### Things you can tweak

- **Speeds**: the `SPEEDS` list at the top of `js/app.js` (pixels per second).
- **Spider colors**: the `COLORS` list in `js/app.js`.
- **Sample story**: the `SAMPLE` text in `js/app.js`.
- **Grammar rules for the private checker**: the `RULES` list in `js/checker.js`. Each rule is a regular expression plus a short function that returns the message and the fix.
- **Extra allowed words**: `EXTRA_WORDS` in `js/checker.js`.
- **Catch colors**: `--c-spelling`, `--c-grammar` and `--c-style` at the top of `style.css`.

## Limits

- Scanned PDFs are pictures of text, so there's nothing for the spider to read. It tells you when a page has no text.
- The document view shows the text only, not the original fonts, images or layout of a PDF or Word file.
- The private checker is English only. The online checker supports English (US, UK, Canada, Australia) and can detect other languages automatically.

## Credits

- [LanguageTool](https://languagetool.org) public API for online grammar and spelling checks ([privacy policy](https://languagetool.org/legal/privacy))
- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla (Apache 2.0) for reading PDFs
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) (BSD 2-Clause) for reading Word files
- [Typo.js](https://github.com/cfinke/Typo.js) (BSD 3-Clause) with the Hunspell en_US dictionary from SCOWL for private spell checking
- Fonts: [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible) and [Literata](https://fonts.google.com/specimen/Literata) from Google Fonts

All libraries load from public CDNs, so the repository stays small.
