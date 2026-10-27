# Spell Spider 🕷️

A proofreading spider that walks straight down the middle of your documents. It never stops: as it goes, its long legs reach out and step right onto every spelling and grammar mistake. The moment a foot lands on a mistake, the mistake gets a colored outline and is added to the list.

It's a plain website (HTML, CSS and JavaScript), so it runs for free on GitHub Pages with no server, no build step and nothing to install.

## What it does

- **Upload several files at once**: `.txt`, `.md`, `.pdf`, `.docx` (Word), `.rtf` (WordPad, TextEdit) and `.html`. Drag and drop works anywhere on the page.
- **The spider walks down the middle of every page**, page after page and document after document, at a steady speed.
- **Its legs catch the mistakes.** Each of the eight feet stays planted until the body has walked past, then steps forward again, like a real spider. When a mistake comes within reach, the closest free leg steps onto it and the mistake lights up:
  - red for spelling
  - amber for grammar
  - blue for style and punctuation
- **It never stops for a catch.** Several legs can grab mistakes at the same time, even at the fastest speed.
- **Speed control** from Crawl to Zoom (10 steps), adjustable while it walks.
- **Customize the spider**: body size, color (five presets or any color), silk thread on or off, an optional catch sound.
- **Controls**: Start, Pause and Resume, Skip page, Find all now, Walk again.
- **The mistakes list** shows each one with an explanation and suggested fixes. Select one to jump to it in the document.
- **Filters** hide or show spelling, grammar or style mistakes.
- **Words to ignore** for names, game terms and slang.
- **Download report** saves every caught mistake as a `.csv` file you can open in Excel or Google Sheets.
- Remembers your settings, works on phones, and has a dark mode.

## Two ways to check

| | Online (default) | Private |
|---|---|---|
| Spelling | Very good (LanguageTool and the dictionary together) | Good (Hunspell English dictionary) |
| Grammar | Very good, plus the private checker's rules on top | Common mistakes (their/there, your/you're, could of, a/an, were/where, repeated words, capital letters and more) |
| Where your text goes | Sent to [LanguageTool](https://languagetool.org)'s free public API | Never leaves your browser |
| Needs internet | Yes | No |

In Online mode both checkers run on every page and their results are combined. That matters because LanguageTool gives up on text with lots of mistakes (it assumes you picked the wrong language) and then reports nothing. The built-in checker still finds those mistakes, and if LanguageTool can't be reached at all, the built-in checker does all the work. Either way the spider always has every mistake to find.

**About LanguageTool's free limits:** the public API allows about 20 requests and 75 KB of text per minute. Spell Spider stays under that by itself. For very long documents the spider may sit at the top of a page with a "Reading ahead…" bubble while it waits for that page to be checked. That's normal.

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `spell-spider`). Make it **Public**.
2. Select **Add file → Upload files** and drag in everything from this folder, keeping the `js` and `lib` folders:
   ```
   index.html
   style.css
   README.md
   js/app.js
   js/checker.js
   js/extract.js
   js/spider.js
   lib/en_US.js
   lib/mammoth.browser.min.js
   lib/pdf.min.js
   lib/pdf.worker.min.js
   lib/typo.js
   lib/licenses/...
   ```
   Tip: unzip `spell-spider.zip`, open the `spell-spider` folder, select everything inside it, and drag it all onto the upload page at once. GitHub keeps the folders.
3. Select **Commit changes**.
4. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, then **Save**.
5. Wait a minute or two. Your site appears at `https://YOUR-USERNAME.github.io/spell-spider/`.

### Running it on your own computer

Double-click `index.html`. Everything it needs is in the `lib` folder, so text, PDF and Word files and the private checker all work straight from your disk, even offline. (The online checker still needs internet.)

If your browser is strict about local files, you can also run a tiny local server from the folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## How it works

| File | Job |
|---|---|
| `index.html` | Page layout: top bar, documents and settings, the pages, the mistakes list |
| `style.css` | All the styling, including dark mode and phone layout |
| `js/spider.js` | Draws the spider as SVG. Each leg has an upper part that sticks out from the body and a lower part that arches down to wherever the foot needs to be |
| `js/extract.js` | Reads files. PDFs use PDF.js and get their lines and paragraphs rebuilt. Word files use mammoth.js. RTF and HTML are turned into plain text. Long text files are split into pages |
| `js/checker.js` | The two checkers: LanguageTool (online, rate-limited) and the private one (Hunspell dictionary through Typo.js plus about 30 grammar rules) |
| `js/app.js` | Ties it together: renders pages, finds where every mistake sits on screen, walks the spider down the middle, and moves its feet |
| `lib/` | The bundled libraries and the English dictionary |

Each document is checked in the background as soon as you add it. The mistakes are already marked in the page but kept invisible. When the spider starts a page, the app measures exactly where every mistake is. As the body walks down the center, any mistake that comes within reach (a little ahead of the front legs) gets assigned to the best free leg, preferring legs on the same side. That leg steps onto it, and the instant the foot lands the mistake becomes visible with a lasso animation and a little ring where the foot touched down. The other legs keep walking normally in two alternating groups of four. Before moving to the next page, the app double-checks that nothing on the page was missed.

### Things you can tweak

- **Speeds**: the `SPEEDS` list at the top of `js/app.js` (pixels per second).
- **Body size**: `BODY_SCALE` in `js/app.js`.
- **Leg positions**: `HOME` in `js/app.js` (where each foot rests) and `LOOK_AHEAD` (how far ahead the legs reach for mistakes).
- **Spider colors**: the `COLORS` list in `js/app.js`.
- **Sample story**: the `SAMPLE` text in `js/app.js`.
- **Grammar rules for the private checker**: the `RULES` list in `js/checker.js`. Each rule is a regular expression plus a short function that returns the message and the fix.
- **Extra allowed words**: `EXTRA_WORDS` in `js/checker.js`.
- **Catch colors**: `--c-spelling`, `--c-grammar` and `--c-style` at the top of `style.css`.

## Limits

- Scanned PDFs are pictures of text, so there's nothing for the spider to read. It tells you when a page has no text.
- The document view shows the text only, not the original fonts, images or layout of a PDF or Word file.
- Old Word files (`.doc`) aren't supported. Save them as `.docx` first.
- The private checker is English only. The online checker supports English (US, UK, Canada, Australia) and can detect other languages automatically.
- No checker catches everything. Words that are spelled right but used wrong (like "by" instead of "buy") are the hardest, and the online checker is much better at those.

## Credits

- [LanguageTool](https://languagetool.org) public API for online grammar and spelling checks ([privacy policy](https://languagetool.org/legal/privacy))
- [PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174 by Mozilla (Apache 2.0) for reading PDFs
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.13.0 (BSD 2-Clause) for reading Word files
- [Typo.js](https://github.com/cfinke/Typo.js) 1.4.0 (BSD 3-Clause) with the Hunspell en_US dictionary from [SCOWL](http://wordlist.aspell.net) for private spell checking
- Fonts: [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible) and [Literata](https://fonts.google.com/specimen/Literata) from Google Fonts

License texts for the bundled libraries are in `lib/licenses/`.
