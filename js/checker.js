/* ==========================================================================
   Spell Spider — checking engines
   Two engines share one shape: check(text) -> Promise<Match[]>
   A Match is { offset, length, message, replacements[], category, ruleId }
   category is one of: "spelling" | "grammar" | "style"
   ========================================================================== */
(function () {
  "use strict";

  const TYPO_URL = "https://cdn.jsdelivr.net/npm/typo-js@1.4.0/typo.js";
  const DICT_BASE = "https://cdn.jsdelivr.net/npm/typo-js@1.4.0/dictionaries/en_US/en_US";
  const LT_URL = "https://api.languagetool.org/v2/check";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded) return resolve();
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Could not load " + src)));
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.dataset.src = src;
      s.async = true;
      s.onload = () => { s.dataset.loaded = "1"; resolve(); };
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  /* Keep the capital letter of the original word when suggesting a fix. */
  function matchCase(original, replacement) {
    if (!original || !replacement) return replacement;
    if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
    if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  /* Remove overlapping matches. Earlier start wins; on a tie, higher priority, then longer. */
  function dedupe(matches) {
    const sorted = matches.slice().sort((a, b) =>
      a.offset - b.offset || (b.priority || 0) - (a.priority || 0) || b.length - a.length);
    const out = [];
    let end = -1;
    for (const m of sorted) {
      if (m.length <= 0) continue;
      if (m.offset < end) continue;
      out.push(m);
      end = m.offset + m.length;
    }
    return out;
  }

  /* ------------------------------------------------------------------------
     LanguageTool (online). Free public API limits, per IP:
     20 requests/min (peak), 75 KB of text/min, 20 KB per request.
     We stay well under them and wait politely when we get close.
     ------------------------------------------------------------------------ */
  const LanguageTool = {
    name: "LanguageTool",
    maxRequestBytes: 14000,
    _log: [],
    onWait: null,

    _bytes(text) {
      return new TextEncoder().encode(text).length;
    },

    async _waitTurn(bytes) {
      let announced = false;
      for (;;) {
        const now = Date.now();
        this._log = this._log.filter((x) => now - x.t < 60000);
        const used = this._log.reduce((a, x) => a + x.bytes, 0);
        const last = this._log.length ? this._log[this._log.length - 1].t : 0;
        const okCount = this._log.length < 12;
        const okBytes = used + bytes <= 68000;
        const okGap = now - last >= 2500;
        if (okCount && okBytes && okGap) {
          this._log.push({ t: now, bytes });
          if (announced && this.onWait) this.onWait(false);
          return;
        }
        let wait = 400;
        if (!okGap) wait = Math.max(wait, 2500 - (now - last));
        if ((!okCount || !okBytes) && this._log.length) {
          wait = Math.max(wait, 60000 - (now - this._log[0].t) + 50);
          if (!announced && this.onWait) { this.onWait(true); announced = true; }
        }
        await sleep(Math.min(wait, 5000));
      }
    },

    _category(rule) {
      if (!rule) return "grammar";
      const issue = (rule.issueType || "").toLowerCase();
      const cat = ((rule.category && rule.category.id) || "").toUpperCase();
      if (issue === "misspelling" || cat === "TYPOS") return "spelling";
      if (issue === "grammar") return "grammar";
      if (["GRAMMAR", "CONFUSED_WORDS", "CASING", "PUNCTUATION", "SEMANTICS",
           "COLLOCATIONS", "NONSTANDARD_PHRASES", "MISC", "COMPOUNDING"].includes(cat)) return "grammar";
      return "style";
    },

    async check(text, opts) {
      opts = opts || {};
      const bytes = this._bytes(text);
      for (let attempt = 0; attempt < 3; attempt++) {
        await this._waitTurn(bytes);
        const body = new URLSearchParams({ text, language: opts.language || "en-US" });
        let res;
        try {
          res = await fetch(LT_URL, { method: "POST", body, headers: { Accept: "application/json" } });
        } catch (err) {
          throw new Error("Could not reach LanguageTool. Check your internet connection.");
        }
        if (res.status === 429) {
          if (this.onWait) this.onWait(true);
          await sleep(20000 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error("LanguageTool answered with error " + res.status + ".");
        const data = await res.json();
        return (data.matches || []).map((m) => ({
          offset: m.offset,
          length: m.length,
          message: m.message || (m.rule && m.rule.description) || "Possible problem.",
          replacements: (m.replacements || []).slice(0, 5).map((r) => r.value).filter(Boolean),
          category: this._category(m.rule),
          ruleId: m.rule ? m.rule.id : "",
          priority: 1,
        }));
      }
      throw new Error("LanguageTool is busy right now (too many requests).");
    },
  };

  /* ------------------------------------------------------------------------
     Built-in engine: Hunspell en_US dictionary (via Typo.js) for spelling,
     plus a set of hand-written grammar and punctuation rules.
     Everything runs in the browser; no text leaves the page.
     ------------------------------------------------------------------------ */
  const EXTRA_WORDS = new Set((
    "ok okay emoji emojis selfie selfies blog blogs vlog vlogs livestream livestreams " +
    "wifi smartphone smartphones online gameplay esports gif gifs app apps website websites " +
    "email emails username usernames login logout signup inbox hashtag hashtags podcast podcasts " +
    "youtube youtuber tiktok instagram roblox minecraft fortnite discord github google googled " +
    "screenshot screenshots playlist playlists unfollow multiplayer singleplayer npc npcs " +
    "gamepad touchscreen spreadsheet spreadsheets dropdown checkbox checkboxes laptop laptops " +
    "texted texting lol omg btw fyi diy gameplay coworker coworkers healthcare"
  ).split(/\s+/));

  const COMMON_FIXES = {
    teh: "the", adn: "and", recieve: "receive", recieved: "received", beleive: "believe",
    beleived: "believed", definately: "definitely", definatly: "definitely", seperate: "separate",
    seperately: "separately", occured: "occurred", occurence: "occurrence", untill: "until",
    wich: "which", becuase: "because", beacuse: "because", becasue: "because", alot: "a lot",
    thier: "their", freind: "friend", freinds: "friends", wierd: "weird", truely: "truly",
    tommorow: "tomorrow", tommorrow: "tomorrow", goverment: "government", enviroment: "environment",
    neccessary: "necessary", necesary: "necessary", accomodate: "accommodate", acheive: "achieve",
    arguement: "argument", begining: "beginning", calender: "calendar", cemetary: "cemetery",
    concious: "conscious", embarass: "embarrass", existance: "existence", foriegn: "foreign",
    grammer: "grammar", happend: "happened", independant: "independent", knowlege: "knowledge",
    libary: "library", noticable: "noticeable", occassion: "occasion", posession: "possession",
    publically: "publicly", realy: "really", recomend: "recommend", refered: "referred",
    responsability: "responsibility", rythm: "rhythm", sucess: "success", succesful: "successful",
    suprise: "surprise", tounge: "tongue", writting: "writing", wether: "whether",
    youre: "you're", dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't",
    wont: "won't", isnt: "isn't", wasnt: "wasn't", im: "I'm", ive: "I've", thats: "that's",
    whats: "what's", theyre: "they're", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
    shelfs: "shelves", knifes: "knives", wifes: "wives", lifes: "lives", wolfs: "wolves", childs: "children",
    womans: "women's", gonna: "going to",
  };

  const ABBREVIATIONS = new Set((
    "mr mrs ms dr prof sr jr st vs etc e.g i.e a.m p.m approx dept est fig figs inc ltd co corp " +
    "jan feb mar apr jun jul aug sep sept oct nov dec mon tue tues wed thu thur thurs fri sat sun " +
    "no nos vol vols ch chap pg pp p ed eds al cf ca min max mt ft lb lbs oz in yr yrs hr hrs u.s"
  ).split(/\s+/));

  const PARTICIPLES = {
    went: "gone", ate: "eaten", wrote: "written", took: "taken", drove: "driven", rode: "ridden",
    spoke: "spoken", broke: "broken", chose: "chosen", froze: "frozen", stole: "stolen",
    swam: "swum", drank: "drunk", sang: "sung", began: "begun", ran: "run", gave: "given",
    forgot: "forgotten", knew: "known", grew: "grown", threw: "thrown", flew: "flown",
    shook: "shaken", wore: "worn", tore: "torn", hid: "hidden", bit: "bitten", fell: "fallen",
  };

  const COMPARATIVES = (
    "more less better worse rather greater fewer larger smaller higher lower faster slower bigger " +
    "older younger easier harder stronger weaker longer shorter darker lighter colder hotter warmer " +
    "cooler louder quieter taller cheaper richer poorer smarter nicer happier sadder scarier prettier " +
    "uglier safer wider deeper heavier quicker brighter cleaner closer farther newer simpler tougher " +
    "weirder funnier crazier busier earlier sooner bolder calmer kinder meaner softer sweeter thicker thinner"
  ).split(" ");
  const SUPERLATIVES = COMPARATIVES
    .filter((w) => /er$/.test(w) && !["more", "less", "rather", "better", "worse", "fewer"].includes(w))
    .map((w) => w.replace(/er$/, "est"))
    .concat(["best", "worst"]);
  const COMPARE_RE = COMPARATIVES.join("|");
  const DOUBLE_RE = COMPARATIVES.filter((w) => !["more", "less", "rather", "fewer"].includes(w))
    .concat(SUPERLATIVES).join("|");

  const AUX_BEFORE_HAVE = new Set(("does did do will would can could should might must may shall to let " +
    "make makes made help helps helped watch saw see hear heard had doesn't didn't won't wouldn't can't " +
    "couldn't shouldn't don't").split(" "));

  const BE_FORMS = new Set("am is are was were be been being i'm you're we're they're he's she's it's not".split(" "));

  /* Edit distance where swapping two neighbouring letters counts as one edit.
     Gives up early once the distance must be bigger than max. */
  function osaDistance(a, b, max) {
    const n = a.length, m = b.length;
    if (Math.abs(n - m) > max) return max + 1;
    let prev2 = null, prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const tmp = prev2 || new Array(m + 1);
      prev2 = prev; prev = cur; cur = tmp;
    }
    return prev[m];
  }

  function prevWord(text, index) {
    const m = text.slice(0, index).match(/([A-Za-z'’]+)\s*$/);
    return m ? m[1].toLowerCase().replace(/’/g, "'") : "";
  }

  /* Each rule returns matches for one block of text. */
  const RULES = [
    { // a + vowel sound
      id: "A_AN", category: "grammar",
      re: /\b([Aa])\s+([A-Za-z][\w'’-]*)/g,
      test(m, text) {
        const w = m[2];
        if (w.length < 2 || w === w.toUpperCase()) return null;
        if (m[1] === "A") {
          // A capital "A" mid-sentence is usually a label or grade ("Plan A is"), not the article.
          const before = text.slice(0, m.index).replace(/["'“‘(\[\s]+$/, "");
          if (before.length && !/[.!?:]$/.test(before)) return null;
        }
        const lw = w.toLowerCase();
        const needsAn =
          (/^[aeio]/.test(lw) && !/^(one|once|eu|ewe)/.test(lw)) ||
          (/^u/.test(lw) && !/^u(ni(?![mnd])|nan|s[eua]|t[ieo]|r[aeiou]|b[ie]|kr|vu|ku|ga)/.test(lw)) ||
          /^(hour|honest|honor|honour|heir)/.test(lw);
        if (!needsAn) return null;
        return { offset: m.index, length: m[1].length,
          message: `Use “an” before “${w}”, because it starts with a vowel sound.`,
          replacements: [matchCase(m[1], "an")] };
      },
    },
    { // an + consonant sound
      id: "AN_A", category: "grammar",
      re: /\b([Aa]n)\s+([A-Za-z][\w'’-]*)/g,
      test(m) {
        const w = m[2];
        if (w.length < 2 || w === w.toUpperCase()) return null;
        const lw = w.toLowerCase();
        if (/^(hour|honest|honor|honour|heir|herb|histor)/.test(lw)) return null;
        const consonant =
          (/^[bcdfgjklmnpqrstvwyz]/.test(lw)) ||
          /^(uni(?![mnd])|unan|us[eua]|ut[ieo]|ur[aeiou]|eu|ewe|one\b|once)/.test(lw);
        if (!consonant) return null;
        return { offset: m.index, length: m[1].length,
          message: `Use “a” before “${w}”, because it starts with a consonant sound.`,
          replacements: [matchCase(m[1], "a")] };
      },
    },
    { // repeated word
      id: "REPEATED_WORD", category: "grammar",
      re: /\b([A-Za-z]+)\s+(\1)\b/gi,
      test(m) {
        const pair = (m[1] + " " + m[2]).toLowerCase();
        if (["had had", "that that", "bye bye", "no no", "so so"].includes(pair)) return null;
        return { offset: m.index, length: m[0].length,
          message: `The word “${m[1]}” is repeated.`, replacements: [m[1]] };
      },
    },
    { // lowercase letter starting a sentence
      id: "SENTENCE_CAPITAL", category: "grammar",
      re: /([.!?])(["'”’)\]]?)\s+([a-z][a-z'’]*)/g,
      test(m, text) {
        const before = text.slice(0, m.index + 1);
        const token = (before.match(/(\S+)$/) || ["", ""])[1];
        const bare = token.toLowerCase().replace(/[.!?]+$/, "").replace(/^[("'“‘[]+/, "");
        if (m[1] === "." && (text[m.index - 1] === "." || /\.\.$/.test(token))) return null; // ellipsis
        if (ABBREVIATIONS.has(bare) || ABBREVIATIONS.has(bare.replace(/\./g, ""))) return null;
        if (/^[a-z]$/i.test(bare) || /^([a-z]\.)+[a-z]?$/i.test(bare)) return null;
        if (/\d$/.test(bare) || /[\/@]/.test(token)) return null;
        const word = m[3];
        const start = m.index + m[0].length - word.length;
        return { offset: start, length: word.length,
          message: "Start a new sentence with a capital letter.",
          replacements: [word[0].toUpperCase() + word.slice(1)] };
      },
    },
    { // lowercase "i" used as a pronoun
      id: "LOWERCASE_I", category: "grammar",
      re: /(^|[\s"“(])(i)(?=$|[\s,;:!?'’"”)]|\.(?![a-z]))/g,
      test(m, text) {
        const start = m.index + m[1].length;
        if (m[1] === "(" && text[start + 1] === ")") return null;
        return { offset: start, length: 1, message: "Write the word “I” as a capital letter.", replacements: ["I"] };
      },
    },
    { // phrase confusions
      id: "COULD_OF", category: "grammar",
      re: /\b(could|would|should|must|might|may|could\s*n['’]t|would\s*n['’]t|should\s*n['’]t)\s+(of)\b/gi,
      test(m) {
        const start = m.index + m[0].length - m[2].length;
        return { offset: start, length: 2, message: `Use “have” after “${m[1]}”, not “of”.`,
          replacements: [matchCase(m[2], "have")] };
      },
    },
    {
      id: "THAN_THEN", category: "grammar",
      re: new RegExp(`\\b(${COMPARE_RE})\\s+(then)\\b`, "gi"),
      test(m) {
        const start = m.index + m[0].length - 4;
        return { offset: start, length: 4, message: "Use “than” when comparing things.",
          replacements: [matchCase(m[2], "than")] };
      },
    },
    {
      id: "THEIR_IS", category: "grammar",
      re: /\b(their)\s+(is|are|was|were|will be|has been|have been)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length,
          message: "“Their” means belonging to them. Here you probably mean “there”.",
          replacements: [matchCase(m[1], "there")] };
      },
    },
    {
      id: "THERE_OWN", category: "grammar",
      re: /\b(there|they['’]re)\s+(own|car|cars|house|houses|book|books|phone|phones|dog|dogs|cat|cats|parents|friends|names?|family|teacher|homework|room|rooms)\b/gi,
      test(m, text) {
        if (/^there$/i.test(m[1]) && /\b(over|in|out|up|down|from|go|went|get|got)\s*$/i.test(text.slice(0, m.index))) return null;
        return { offset: m.index, length: m[1].length,
          message: `Use “their” to show something belongs to them.`,
          replacements: [matchCase(m[1], "their")] };
      },
    },
    {
      id: "YOUR_YOURE", category: "grammar",
      re: /\b(your)\s+(welcome|not|going\s+to|so|too|the|a|an|gonna|probably|really)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length,
          message: "“Your” shows ownership. Here you probably mean “you're” (you are).",
          replacements: [matchCase(m[1], "you're")] };
      },
    },
    {
      id: "ITS_ITS", category: "grammar",
      re: /\b(its)\s+(a|an|the|not|been|going|so|just|okay|ok|gonna|hard\s+to|easy\s+to|time\s+to)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length,
          message: "“Its” shows ownership. Here you probably mean “it's” (it is).",
          replacements: [matchCase(m[1], "it's")] };
      },
    },
    {
      id: "WHOS_WHOSE", category: "grammar",
      re: /\b(who['’]s)\s+(car|house|book|phone|turn|idea|fault|job|bag|dog|cat|name|side|team)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length,
          message: "Use “whose” to ask who something belongs to.",
          replacements: [matchCase(m[1], "whose")] };
      },
    },
    {
      id: "HE_DONT", category: "grammar",
      re: /\b(he|she|it)\s+(don['’]t)\b/gi,
      test(m) {
        const start = m.index + m[0].length - m[2].length;
        return { offset: start, length: m[2].length, message: `Use “doesn't” with “${m[1]}”.`,
          replacements: ["doesn't"] };
      },
    },
    {
      id: "THEY_WAS", category: "grammar",
      re: /\b(they|we|you)\s+(was)\b/gi,
      test(m) {
        const start = m.index + m[0].length - 3;
        return { offset: start, length: 3, message: `Use “were” with “${m[1]}”.`, replacements: ["were"] };
      },
    },
    {
      id: "HE_HAVE", category: "grammar",
      re: /\b(he|she|it)\s+(have)\b/gi,
      test(m, text) {
        if (AUX_BEFORE_HAVE.has(prevWord(text, m.index))) return null;
        const start = m.index + m[0].length - 4;
        return { offset: start, length: 4, message: `Use “has” with “${m[1]}”.`, replacements: ["has"] };
      },
    },
    {
      id: "I_SEEN", category: "grammar",
      re: /\b(I|we|they|you)\s+(seen)\b/gi,
      test(m) {
        const start = m.index + m[0].length - 4;
        return { offset: start, length: 4, message: "Use “saw”, or “have seen”.", replacements: ["saw", "have seen"] };
      },
    },
    {
      id: "HAVE_WENT", category: "grammar",
      re: /\b(have|has|had|having|'ve|’ve)\s+(went|ate|wrote|took|drove|rode|spoke|broke|chose|froze|stole|swam|drank|sang|began|ran|gave|forgot|knew|grew|threw|flew|shook|wore|tore|fell)\b/gi,
      test(m) {
        const verb = m[2].toLowerCase();
        const start = m.index + m[0].length - m[2].length;
        return { offset: start, length: m[2].length,
          message: `After “${m[1].replace(/^['’]/, "")}”, use “${PARTICIPLES[verb]}” instead of “${m[2]}”.`,
          replacements: [PARTICIPLES[verb]] };
      },
    },
    {
      id: "SUPPOSE_TO", category: "grammar",
      re: /\b(suppose)\s+to\b/gi,
      test(m, text) {
        if (!BE_FORMS.has(prevWord(text, m.index))) return null;
        return { offset: m.index, length: m[1].length, message: "Write “supposed to”.",
          replacements: [matchCase(m[1], "supposed")] };
      },
    },
    {
      id: "LOOSE_LOSE", category: "grammar",
      re: /\b(loose)\s+(weight|my|your|his|her|their|our|it|them|track|the\s+game|everything)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length, message: "“Loose” means not tight. To misplace or fail to win is “lose”.",
          replacements: [matchCase(m[1], "lose")] };
      },
    },
    {
      id: "AN_OTHER", category: "grammar",
      re: /\b(an)\s+(other)\b/gi,
      test(m) {
        return { offset: m.index, length: m[0].length, message: "Write “another” as one word.",
          replacements: [matchCase(m[1], "another")] };
      },
    },
    {
      id: "ALOT", category: "spelling",
      re: /\b(alot)\b/gi,
      test(m) {
        return { offset: m.index, length: 4, message: "“A lot” is two words.", replacements: [matchCase(m[1], "a lot")] };
      },
    },
    {
      id: "IRREGARDLESS", category: "style",
      re: /\b(irregardless)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length, message: "Use “regardless” instead.",
          replacements: [matchCase(m[1], "regardless")] };
      },
    },
    {
      id: "DOUBLE_COMPARATIVE", category: "grammar",
      re: new RegExp(`\\b(more|most)\\s+(${DOUBLE_RE})\\b`, "gi"),
      test(m) {
        return { offset: m.index, length: m[0].length, message: `“${m[2]}” already compares, so drop “${m[1]}”.`,
          replacements: [matchCase(m[1], m[2].toLowerCase())] };
      },
    },
    {
      id: "LESS_FEWER", category: "style",
      re: /\b(less)\s+(people|students|cars|things|items|errors|mistakes|words|books|games|players|friends|times|days|hours|minutes|years|calories|options|choices)\b/gi,
      test(m) {
        return { offset: m.index, length: m[1].length, message: "Use “fewer” for things you can count.",
          replacements: [matchCase(m[1], "fewer")] };
      },
    },
    { // space before punctuation
      id: "SPACE_BEFORE_PUNCT", category: "style",
      re: /(\S)([ \t]+)([,.;:!?])(?=\s|$)/g,
      test(m) {
        if (m[3] === "." && /[.]/.test(m[1])) return null;
        const start = m.index + 1;
        return { offset: start, length: m[2].length + 1, message: "Remove the space before the punctuation mark.",
          replacements: [m[3]] };
      },
    },
    { // missing space after comma
      id: "COMMA_SPACE", category: "style",
      re: /([A-Za-z]),([A-Za-z])/g,
      test(m) {
        return { offset: m.index + 1, length: 2, message: "Add a space after the comma.",
          replacements: [", " + m[2]] };
      },
    },
    { // missing space after a sentence
      id: "SENTENCE_SPACE", category: "style",
      re: /([a-z]{2,}[.!?])([A-Z][a-z]+)/g,
      test(m, text) {
        const left = text.slice(Math.max(0, m.index - 30), m.index + m[0].length);
        if (/[\/@]|www|https?|\.(com|org|net|io|js|py|html)/i.test(left)) return null;
        return { offset: m.index + m[1].length - 1, length: 1 + m[2].length,
          message: "Add a space between sentences.", replacements: [m[1].slice(-1) + " " + m[2]] };
      },
    },
    { // double spaces between words
      id: "DOUBLE_SPACE", category: "style",
      re: /(\S)( {2,})(?=\S)/g,
      test(m) {
        return { offset: m.index + 1, length: m[2].length, message: "There is more than one space here.", replacements: [" "] };
      },
    },
    { // repeated punctuation
      id: "DOUBLE_PUNCT", category: "style",
      re: /,{2,}|;{2,}|(?<!\.)\.\.(?!\.)/g,
      test(m) {
        return { offset: m.index, length: m[0].length, message: "This punctuation mark is repeated.",
          replacements: [m[0][0] === "." ? "." : m[0][0], m[0][0] === "." ? "…" : undefined].filter(Boolean) };
      },
    },
  ];

  const Builtin = {
    name: "Built-in",
    typo: null,
    _loading: null,
    dictionaryFailed: false,

    load() {
      if (this.typo) return Promise.resolve(this.typo);
      if (!this._loading) {
        this._loading = (async () => {
          try {
            await loadScript(TYPO_URL);
            const [aff, dic] = await Promise.all([
              fetch(DICT_BASE + ".aff").then((r) => { if (!r.ok) throw new Error(); return r.text(); }),
              fetch(DICT_BASE + ".dic").then((r) => { if (!r.ok) throw new Error(); return r.text(); }),
            ]);
            await sleep(30); // let the page paint the "loading dictionary" message first
            // eslint-disable-next-line no-undef
            this.typo = new Typo("en_US", aff, dic);
          } catch (e) {
            this.dictionaryFailed = true;
            this.typo = null;
          }
          return this.typo;
        })();
      }
      return this._loading;
    },

    known(word) {
      const w = word.replace(/’/g, "'");
      const lw = w.toLowerCase();
      if (EXTRA_WORDS.has(lw)) return true;
      if (this.typo.check(w)) return true;
      if (/'s$/i.test(w) && this.typo.check(w.slice(0, -2))) return true;
      if (/s'$/i.test(w) && this.typo.check(w.slice(0, -1))) return true;
      return false;
    },

    suggest(word) {
      const lw = word.toLowerCase().replace(/’/g, "'");
      const out = [];
      const add = (s) => { if (s && !out.includes(s)) out.push(s); };
      if (COMMON_FIXES[lw]) add(COMMON_FIXES[lw]);
      if (/[^aeiou]ys$/.test(lw) && this.typo.check(lw.slice(0, -2) + "ies")) add(lw.slice(0, -2) + "ies"); // countrys -> countries
      const letters = "abcdefghijklmnopqrstuvwxyz";
      const n = lw.length;
      const tryWord = (c) => { if (c && c !== lw && this.typo.check(c)) add(c); };
      for (let i = 0; i < n - 1; i++) tryWord(lw.slice(0, i) + lw[i + 1] + lw[i] + lw.slice(i + 2));
      for (let i = 0; i < n; i++) for (const ch of letters) if (ch !== lw[i]) tryWord(lw.slice(0, i) + ch + lw.slice(i + 1));
      for (let i = 0; i < n; i++) tryWord(lw.slice(0, i) + lw.slice(i + 1));
      for (let i = 0; i <= n; i++) for (const ch of letters) tryWord(lw.slice(0, i) + ch + lw.slice(i));
      if (out.length < 2) {
        for (const c of this.nearby(lw)) add(c);
      }
      if (out.length < 2) {
        for (let i = 1; i < n; i++) {
          const a = lw.slice(0, i), b = lw.slice(i);
          if ((a.length > 1 || a === "a" || a === "i") && b.length > 1 && this.typo.check(a) && this.typo.check(b)) add(a + " " + b);
        }
      }
      return out.slice(0, 4).map((s) => matchCase(word, s));
    },

    /* Words two small edits away (e.g. "schedual" -> "schedule"). Uses an index of
       dictionary words grouped by first letter so it stays fast. */
    nearby(word) {
      if (!this._index) {
        this._index = new Map();
        for (const w of this.typo.dictionaryTable.keys()) {
          if (w.length < 3 || /[^a-z']/.test(w)) continue;
          const k = w[0];
          if (!this._index.has(k)) this._index.set(k, []);
          this._index.get(k).push(w);
        }
      }
      const n = word.length;
      if (n < 4 || n > 18) return [];
      const keys = new Set([word[0], word[1]]); // allow the first two letters to be swapped
      const found = [];
      for (const k of keys) {
        for (const w of this._index.get(k) || []) {
          if (Math.abs(w.length - n) > 2) continue;
          const d = osaDistance(word, w, 2);
          if (d <= 2) found.push({ w, d, sameStart: w[0] === word[0] && w[1] === word[1] });
        }
      }
      found.sort((a, b) => a.d - b.d || b.sameStart - a.sameStart || Math.abs(a.w.length - n) - Math.abs(b.w.length - n));
      return found.slice(0, 3).map((f) => f.w);
    },

    spelling(text) {
      const matches = [];
      if (!this.typo) return matches;
      const skip = [];
      for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|\b\S+\.(?:com|org|net|io|edu|gov)\b\S*/gi)) {
        skip.push([m.index, m.index + m[0].length]);
      }
      const inSkip = (i) => skip.some(([a, b]) => i >= a && i < b);
      const wordRe = /[A-Za-zÀ-ɏ]+(?:['’][A-Za-z]+)*/g;
      for (const m of text.matchAll(wordRe)) {
        const w = m[0];
        const i = m.index;
        if (w.length < 2) continue;
        if (/\d/.test(text[i - 1] || "") || /\d/.test(text[i + w.length] || "")) continue;
        if (/[A-Z]/.test(w.slice(1))) continue; // acronyms, CamelCase, McNames
        if (inSkip(i)) continue;
        if (/^[A-Z]/.test(w)) {
          // Capitalized words in the middle of a sentence are usually names. Skip them.
          const before = text.slice(0, i).replace(/["'“‘(\[\s]+$/, "");
          const sentenceStart = before.length === 0 || /[.!?:]$/.test(before) || /\n\s*$/.test(text.slice(0, i));
          if (!sentenceStart) continue;
        }
        if (this.known(w)) continue;
        const capital = w[0].toUpperCase() + w.slice(1);
        if (capital !== w && this.typo.checkExact(capital)) {
          // A real word that needs a capital letter: days, months, places, names
          matches.push({ offset: i, length: w.length, word: w,
            message: `Write “${capital}” with a capital letter.`, replacements: [capital],
            category: "spelling", ruleId: "NEEDS_CAPITAL", priority: 1 });
          continue;
        }
        matches.push({ offset: i, length: w.length, word: w,
          message: `“${w}” may be misspelled.`, replacements: null, category: "spelling",
          ruleId: "SPELLING", priority: 1 });
      }
      return matches;
    },

    grammar(text) {
      const out = [];
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        for (const m of text.matchAll(rule.re)) {
          const r = rule.test(m, text);
          if (r) out.push(Object.assign({ category: rule.category, ruleId: rule.id, priority: 2 }, r));
        }
      }
      return out;
    },

    async check(text) {
      await this.load();
      const all = dedupe(this.grammar(text).concat(this.spelling(text)));
      for (const m of all) {
        if (m.replacements === null) {
          try { m.replacements = this.suggest(m.word); } catch (e) { m.replacements = []; }
        }
      }
      return all;
    },
  };

  window.SpiderCheck = { LanguageTool, Builtin, dedupe, loadScript };
})();
