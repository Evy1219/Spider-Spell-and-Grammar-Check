# Spell Spider 🕷️ (v5)

A proofreading spider that walks straight down the middle of your documents. It never stops: as it goes, its long legs reach out and step right onto every spelling and grammar mistake. The moment a foot lands on a mistake, the mistake gets a colored outline and is added to the list.

It's a plain website, so it runs for free on GitHub Pages with no server, no build step and nothing to install. The whole app is **one file, `index.html`**. The `lib` folder holds the PDF and Word readers and the English dictionary.

## What it does

- **Add text three ways**: upload files (`.txt`, `.md`, `.pdf`, `.docx`, `.rtf`, `.html`, several at once), drag and drop them anywhere, or paste text straight in with **Or paste text instead**.
- **The spider walks down the middle of every page**, page after page and document after document, at a steady speed.
- **Its legs catch the mistakes.** Each of the eight feet stays planted until the body has walked past, then steps forward again, like a real spider. When a mistake comes within reach, the closest free leg steps onto it and the mistake lights up:
  - red for spelling
  - amber for grammar
  - blue for style and punctuation
- **It never stops for a catch.** Several legs can grab mistakes at once. When a page is packed with mistakes, the legs move faster and the body eases off a little so every single one still gets stepped on.
- **Nothing gets left behind.** Before moving to the next page, the app double-checks that every mistake on it was caught.
- **Speed control** from Crawl to Zoom (10 steps), adjustable while it walks.
- **Customize the spider**: body size, color (five presets or any color), silk thread on or off, an optional catch sound.
- **Controls**: Start, Pause and Resume, Skip page, Find all now, Walk again.
- **The mistakes list** shows each one with an explanation and suggested fixes. Select one to jump to it in the document.
- **Filters** hide or show spelling, grammar or style mistakes. They always start switched on, and at least one stays on.
- **Words to ignore** for names, game terms and slang.
- **Download report** saves every caught mistake as a `.csv` file you can open in Excel or Google Sheets.
- Each document shows how many mistakes were found before the walk and how many were caught after it.
- Remembers your speed, size, color and sound settings, works on phones, and has a dark mode.

## How mistakes are found

The **built-in checker** always runs. It's bundled with the app (Hunspell English dictionary plus about 30 grammar rules), works offline and never gives up, no matter how many mistakes there are.

In **Online** mode (the default), your text is also sent to [LanguageTool](https://languagetool.org), which is better at grammar. The two results are combined. If LanguageTool is slow, the page doesn't wait for it: the built-in results show up right away and LanguageTool's extra finds are added when they arrive. If LanguageTool is offline, busy or refuses a text, the built-in checker's results are used and a short message says so.

**Private** mode uses only the built-in checker, so your text never leaves your browser.

**About LanguageTool's free limits:** the public API allows about 20 requests and 75 KB of text per minute. Spell Spider stays under that by itself.

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `spell-spider`). Make it **Public**.
2. Select **Add file → Upload files**. Unzip `spell-spider.zip`, open the `spell-spider` folder, select everything inside it (`index.html`, `README.md` and the `lib` folder), and drag it all onto the upload page. GitHub keeps the folder.
3. Select **Commit changes**.
4. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, then **Save**.
5. Wait a minute or two. Your site appears at `https://YOUR-USERNAME.github.io/spell-spider/`.

### Updating to a new version

1. Upload the new `index.html` (and the `lib` folder if it changed) the same way. GitHub replaces the old files.
2. Wait a minute or two, then open your site and press **Ctrl+Shift+R** (Cmd+Shift+R on a Mac) so the browser loads the new version instead of the one it saved.
3. Check the little version badge next to the "Spell Spider" title. It should say **v5**.

Older versions had a `js` folder and a `style.css` file. This version doesn't use them, so you can delete them from your repository.

### Running it on your own computer

Double-click `index.html`. Everything it needs is in the file and the `lib` folder, so text, PDF and Word files and the built-in checker all work straight from your disk, even offline. (LanguageTool still needs internet.)

## How the spider catches mistakes

Each document is checked in the background as soon as you add it. The mistakes are already marked in the page but kept invisible. When the spider starts a page, the app measures exactly where every mistake is. As the body walks down the center, any mistake that comes within reach (a little ahead of the front legs) gets assigned to the best free leg, preferring legs on the same side. That leg steps onto it, and the instant the foot lands the mistake becomes visible with a lasso animation and a little ring where the foot touched down. The other legs keep walking normally in two alternating groups of four.

Safety nets: if the body ever passes a mistake that no leg could get to, it's caught anyway; if anything goes wrong while walking, the page is finished off and the walk carries on; and if the spider ever stops moving, a watchdog moves it to the next page.

### Things you can tweak (all in `index.html`)

- **Speeds**: the `SPEEDS` list.
- **Body size**: `BODY_SCALE`.
- **Leg positions**: `HOME` (where each foot rests) and `LOOK_AHEAD` (how far ahead the legs reach for mistakes).
- **Spider colors**: the `COLORS` list.
- **Sample story**: the `SAMPLE` text.
- **Grammar rules for the built-in checker**: the `RULES` list. Each rule is a regular expression plus a short function that returns the message and the fix.
- **Extra allowed words**: `EXTRA_WORDS`.
- **Catch colors**: `--c-spelling`, `--c-grammar` and `--c-style` near the top of the styles.

## Limits

- Scanned PDFs are pictures of text, so there's nothing for the spider to read. It tells you when a page has no text.
- The document view shows the text only, not the original fonts, images or layout of a PDF or Word file.
- Old Word files (`.doc`) aren't supported. Save them as `.docx` first.
- The built-in checker is English only. LanguageTool supports English (US, UK, Canada, Australia) and can detect other languages automatically.
- No checker catches everything. Words that are spelled right but used wrong (like "by" instead of "buy") are the hardest, and LanguageTool is much better at those.

## Credits

- [LanguageTool](https://languagetool.org) public API for online grammar and spelling checks ([privacy policy](https://languagetool.org/legal/privacy))
- [PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174 by Mozilla (Apache 2.0) for reading PDFs
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.13.0 (BSD 2-Clause) for reading Word files
- [Typo.js](https://github.com/cfinke/Typo.js) 1.4.0 (BSD 3-Clause) with the Hunspell en_US dictionary from [SCOWL](http://wordlist.aspell.net) for spell checking
- Fonts: [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible) and [Literata](https://fonts.google.com/specimen/Literata) from Google Fonts

License texts for the bundled libraries are in `lib/licenses/`.
