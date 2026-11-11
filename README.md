# Oris 3.2 – focus for study, research and earning

A Chrome extension (Manifest V3) that opens in Chrome's side panel.

**Study mode (v1)**
- **Focus timer.** Pomodoro-style focus, short-break and long-break cycle with 25/5, 50/10 and 90/20 presets or custom lengths. Includes auto-start options, notifications, a toolbar badge, a keyboard shortcut (Alt+Shift+O), today's stats, a 7-day chart and a streak.
- **Website blocker.** Off, during focus, or always. Use a block list (with quick-add sets for Social, Entertainment, Shopping and News) or allow-only mode. Tabs already open on a blocked site are moved to the blocked page.
- **Distraction blocker.** Hides YouTube Shorts, the home feed, recommendations, end screens and comments. Also hides the Instagram Reels/Explore and feed, Facebook feed, X timeline/trending, Reddit front page and LinkedIn feed.
- **Hard mode.** During focus you can't pause, stop, skip or loosen the blocker.
- **Syllabus planner.** Upload a PDF or text file, or paste text. Oris splits it into units and topics, finds and ranks YouTube lectures per topic, and tracks topics done and videos watched.

**Research mode (new in 1.1)**
- **Projects.** Keep each essay, report or thesis separate.
- **Save sources.** Saves the page or online PDF you're reading. Oris reads the author, date and site name from the page's metadata.
- **Highlights.** Select text, then right-click and choose **Highlight with Oris**, or press **Alt+Shift+H**. Highlights reappear whenever you reopen the page. Recolour them, add notes, or jump back to them with "Show on page".
- **Summaries.** Get an AI summary and key points with a Groq key, or key sentences without one. This works for the open tab, any saved source, and online PDFs.
- **Citations.** APA 7, MLA 9 or IEEE for each source, with editable details. Copy them with italics intact.
- **Bibliography.** The whole project's reference list. Copy it, or download it as .txt or BibTeX (.bib).
- **Sessions.** Save every tab in the window, with an option to close them, and reopen them all later.

**New in 1.2**
- **New Tab home.** Oris replaces Chrome's New Tab page. The sun moves along a horizon arc with the time of day, and the arc becomes the timer while a session runs. It also has your one focus for today, a search box (uses your default search engine) and a start button.
- **Burst transition.** Pressing S, R or E (or clicking a mode) bursts open that mode full page. Esc or "‹ Home" goes back.
- **Shortcuts on New Tab.** Space starts or pauses focus, N writes a quick note, / jumps to search.
- **Onboarding.** Three questions on first run set your session length, break rhythm and blocking level. An optional 3-step tour follows. Run it again from Settings.
- **Tasks.** Add today's tasks and pick one under the timer. Focus time and completed sessions are counted on the task.
- **Quick notes.** Notes are tied to the current session and can get an AI summary with a Groq key. Alt+Shift+N opens the note box from any page.
- **Mini-app dock.** Calculator (handles %, sqrt and Indian digit grouping), a stopwatch, and up to 12 pinned links.
- **Session-complete celebration.** Animations can be set to Full, Low or Off. Your system's reduce-motion setting always turns them off.
- **New blocking level, "Focus + breaks".** Sites stay blocked until you stop the timer.
- **Restore backup.** Settings → Restore backup brings back a downloaded backup and keeps your API keys.

**New in 1.3 (Research depth)**
- **Research this page.** One click saves the page, summarises it, and shows its citation ready to copy.
- **Summary length.** Choose TL;DR, Standard or Detailed. The choice is remembered.
- **DOI.** Read automatically from journal pages, and editable in "Edit details". Citations link to https://doi.org/… instead of the page address.
- **Chicago style.** Added alongside APA 7, MLA 9 and IEEE.
- **Tags.** Add tags to sources (Enter or comma), then filter the source list by tag.
- **Ask.** A new tab in Research answers questions from a project's saved pages, highlights and notes. With a Groq key you get a written answer with numbered links to the passages used; without one, you get the best matching passages. Pages saved before 1.3 can be read once with "Read those pages".
- **Export project (.md).** Bibliography → one Markdown file with every source's details, tags, summary, highlights and notes, plus the bibliography.

**Keyboard shortcuts**
| Keys | Where they work |
| --- | --- |
| Alt+Shift+O (start/pause), Alt+Shift+H (highlight), Alt+Shift+N (quick note) | Any web page. Chrome only assigns these if no other extension already uses the key. Settings → Keyboard shortcuts shows which are set and opens Chrome's shortcuts page to fix the rest. |
| Space, N, S, R, E, / | Only the Oris New Tab page, after you click the page. Chrome always gives a new tab's address bar the keyboard first, and the page shows a reminder until you click. |

**New in 3.2 (AI coach)**

- **Coach on the Plan page.** Up to two tips at a time, each with a one-tap fix and "Not now". It notices when a topic keeps moving to tomorrow (split it into 2 or 3 parts), when days are too full (lighter days), when you finish early (add more), when a lecture was skipped (rewatch), and when a streak is at risk or you've been away (restart small).
- **Split topics.** A big topic becomes "part 1 of 2", "part 2 of 2" across days. The topic is marked learned only when the last part is done.
- **It learns from you, on your device.** Tips you accept show up more; tips you dismiss show up less, and three "Not now"s in 30 days mute that kind of tip. Turn muted tips back on in Plan settings.
- **Your week.** A weekly review: time studied, active days, lectures, streak and a short note. "Get a personal review (AI)" writes a personal one.
- **Reminders.** At most one a day: at your usual study time if you haven't started, or in the evening if your streak is at risk. None once today's work is done.
- **Your data.** Every change you make is logged on your device. "Download my learning data" exports it. "Help improve Oris" (off by default) shares anonymous events (kind, day, hour, level; no names, topics or notes) once a day; for school students it needs a parent or guardian to agree first.

**New in 3.1 (Lectures and the Oris player)**

- **Study → Lectures.** A playlist for every subject: one lecture per topic, in study order (prerequisites first).
  - **Find lectures for all topics:** Oris picks the best lecture per topic, preferring proper lecture length, real views and approval, with no Shorts or live streams.
  - **Change:** choose from the top 5, or paste any YouTube link.
  - **Find a full-course playlist,** or paste a playlist link: Oris puts each video on the topic it matches and lists the rest under "More from the playlist".
  - **Search:** uses your own YouTube key if you added one, otherwise the Oris server (needs `YOUTUBE_API_KEY` on the server).
- **The Oris lecture player** (opens in its own tab, no recommendations or comments around the video):
  - **Notes:** timestamped notes (press N); the video pauses while you type, and clicking a time jumps there.
  - **Sticky notes:** pinned on the timeline (press P), in 4 colours.
  - **Playback:** speed 0.75–2× ([ and ]), ±10 s (J and L), A–B loop to rewatch a hard part, full screen (F), resume where you left off.
  - **Playlist:** the playlist is beside the video, with auto-play of the next lecture after a completed one.
  - **Practice:** 5 AI questions on the topic and your notes. +5 points per right answer, +10 for a perfect score, only for beating your best (no farming).
  - **Completion:** a lecture counts as done when you've watched most of it (skipping to the end doesn't count). You get +20 points and the topic is marked learned in your plan and syllabus.
  - **Notes out:** download them as Markdown with clickable timestamps, or add them to your Oris notes.
  - **Focus while watching:** starts a focus session; blocking is on, and YouTube still plays inside Oris.
- **Plan:** a Learn item now shows **▶ Lecture** (opens the player) or **Find lecture**.
- **Points:** lecture points count towards your level (Earn → Rewards).
- **How playback works:** YouTube often refuses to play inside extension pages, so the video runs in a tiny relay page on GitHub Pages (`docs/player/` in the repo), with a direct embed as the backup. If neither works, Oris offers "Open on YouTube". YouTube ads play as normal.

**New in 3.0 (Study plan)**

- **First-run setup.** After the 3 welcome questions on the New Tab, "Set up my study plan" opens a 6-step setup: your name; school, college or competitive exam (with class, board, college, course or exam name); subjects with exam date, marks and importance; each subject's syllabus (upload, paste or pick one you already added); past papers (upload, or **Find papers for me**); and study time (hours per day, rest days, revision days). Existing users find it under Study → **Plan**.
- **Find papers for me.** Oris searches the web for your college's or board's past papers. Official sites (.ac.in, .edu, .gov.in…) are listed first and tagged. Tap **Use this** on a PDF and Oris downloads and reads it. Tap **Open PDFs** on a page and Oris lists the PDFs on it. Also available in Syllabus → Exam prep. It needs a search key on the server (see "Server setup").
- **Study → Plan.** Every day up to your exams, worked out from:
  - **What to study first:** marks × your importance × how often a topic comes up in past papers × how close the exam is.
  - **Topic order:** prerequisites first (AI works out "learn A before B"; remove any rule with ×).
  - **Each topic:** Learn → Practice → Past questions.
  - **Before each exam:** revision days, ending with a mock test the day before. Exam days and rest days stay free.
  - **Goals:** one per subject ("finish all topics before 20 Nov"), split into weekly sub-goals.
  - **What doesn't fit:** listed honestly under "Not in the plan", lowest priority first.
- **You can change everything:**
  - Tick work done, **Focus** on an item, open the **Lecture** search.
  - Under **More**: *Do it tomorrow*, *Needs more time*, *Shorter*, *Skip this topic* (and *Put back*).
  - In Plan settings: exam dates, marks, importance, hours per day, rest days, revision days.
  - The plan updates instantly, and missed work moves forward by itself.
- **Learning log.** Every change you make is recorded on this device only (Study data in backups). The 3.2 coach will learn from it.
- Study opens on Focus as before until a plan exists, then on Plan.

**New in 2.2 (Exam prep: PYQs, practice, mock tests)**

Open a syllabus and you now get two tabs: **Topics**, which works the same as before, and **Exam prep**.
- **Past papers.** Upload previous-year papers (PDF or text, several at once) or paste one. Oris reads every question, its marks and the year, and matches it to a syllabus topic (with AI when it's on, otherwise with built-in rules). You can move any question to another topic by hand.
- **Most asked topics.** Each topic shows how many of your papers it came up in, with all its past questions.
- **Study these first.** Unfinished topics ranked by how often they're asked, with a **Focus** button.
- **Find papers online / Find PYQs online.** Ready Google searches for the subject or a topic.
- **Practice questions** (needs AI). Per topic, Exam → Practice questions. For university exams you get written questions with answer outlines. For competitive exams (set Exam type) you get MCQs with answers and explanations. They're labelled as practice, never as real PYQs.
- **Mock test.** Pick past papers, practice or both; finished topics, the whole syllabus or one unit; how many questions; and the time limit. The timer keeps running even if you close the panel. Afterwards you mark each answer Got it / Partly / Missed, and MCQs mark themselves. Missed topics get a **Revise** tag and move up in "Study these first".
- In the Topics tab each topic shows **Asked 2/3** and **Revise** tags and an **Exam** button for its past questions and practice.

**New in 2.1 (Oris AI and Store-ready)**

- **Oris AI.** AI features now work without a key. Requests go through the Oris AI server (Supabase function `oris-ai`), which calls Groq with the project's key. Each install gets 30 free requests a day (60 per IP, 2,000 total). Add your own Groq key and Oris goes to Groq directly with no limit. Settings → AI → "Use Oris AI" turns it off.
- New name for the Store: "Oris – Focus for Study, Research & Earning".

**New in 2.0 (Earn mode)**

- **Overview.** Log income (received or still waiting), see this month, the last 6 months, top sources, and earnings per client hour. Pick a currency (₹ by default). "Hide amounts" masks every figure for screen sharing. Download income as CSV.
- **Work.** Add clients or projects with an hourly rate, start a work timer, stop to log the time and its value. Add time by hand, archive old clients, download CSV.
- **Jobs.** Track jobs, internships, gigs and freelance bids by stage (Saved, Applied, Interview, Offer, Not selected). Set a follow-up date and Oris sends a reminder that day. "Focus on applying" starts a focus session with blocking on.
- **Skills.** Break a paid skill into steps with course links. "Focus" on a step starts a session whose time counts to that skill.
- **Rewards.** Levels and 16 badges earned only from real work (focus time, tasks, sources, applications, skill steps, client hours, payments). New badges pop up as a toast.
- Backups (Settings) now include Earn data.

## Run it

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `oris` folder (the one that contains `manifest.json`).
4. Pin Oris from the puzzle-piece menu, then click its icon. The side panel opens.

After you change any file, click the reload icon on the Oris card in `chrome://extensions`.

### Optional keys (Settings, gear icon)
Both keys are free, and Oris works without them.
- **Groq API key** gives smarter topic detection from messy syllabi. Get one at console.groq.com/keys.
- **YouTube Data API v3 key** gives ranked lecture picks inside Oris. Get one at console.cloud.google.com: enable "YouTube Data API v3", then create an API key. Without it, each topic gets a "Search" button that opens YouTube results.
  - Quota: each topic lookup costs about 101 units, and the free quota is 10,000 units a day (about 99 topics).

Keys are stored in `chrome.storage.local` on this device only. For a public Chrome Web Store launch, move both calls behind your own backend so users don't need keys.

## Test it

**Automated (Node 20+):**
```
npm install
npm test
```
This runs the real code against a mocked `chrome.*` API:
- the syllabus parser
- the background timer cycle and blocking rules
- the full side panel in jsdom
- the content script
- the blocked page
- PDF extraction

**Manual checklist in Chrome, version 3.2:**
1. Reload Oris (Chrome may ask nothing new; no new permissions). Study → **Plan**. With a fresh plan the coach is quiet; it needs a few days of history.
2. Quick test: on a Learn item use More → **Do it tomorrow** on two different days (or the same topic twice). The coach shows "“Topic” keeps moving to tomorrow" → **Split into 2 parts**. Today shows "part 1 of 2". Tick it: the topic is *not* ticked in Syllabus yet. Tick part 2 later: now it is.
3. Click **Not now** on a tip: it disappears for 3 days. After 3 dismissals of the same kind it's muted; Plan settings → Coach lists it; click it to turn it back on.
4. **Your week** card appears after a week of use. Click **Get a personal review (AI)** (needs Oris AI with the GROQ key, or your own key).
5. Plan settings → Coach: switch **Reminders** on, leave today's work undone; around your usual study hour you get one notification. Click it and Oris opens.
6. **Help improve Oris**: for a school student it shows the guardian checkbox; nothing is shared until it's ticked. **Download my learning data** saves a .json file.

**Manual checklist in Chrome, version 3.1:**
1. Make sure GitHub Pages is on (repo Settings → Pages → main, /docs). Open https://futurelabworks.github.io/oris/player/ ; it should say "This page only works inside the Oris extension".
2. Reload Oris. Study → **Lectures**. Click **Choose** on a topic, paste any YouTube lecture link → **Use**.
3. Click the thumbnail. The player opens in a new tab and the video plays. Try Space, J/L, speed, **Loop A** then **B**.
4. Press N, type a note, press Enter. Press P, write a sticky; a pin appears on the timeline. Click a note's time to jump back.
5. Watch to near the end (or test with a short video). You get "+20 points" and the topic is ticked in Syllabus and Plan.
6. Practice tab → **Start practice** (needs Oris AI) → answer 5 questions. Points go up once; retakes only earn more if you beat your best.
7. Back in Lectures: **Find a full-course playlist** or paste a playlist link → Import. Videos land on matching topics.

**Manual checklist in Chrome, version 3.0:**
1. Reload Oris. Study → **Plan** → **Make my study plan**. (Or test first run: remove and re-add Oris, answer the 3 questions, then click **Set up my study plan**.)
2. Step 1: name, choose College, add college and course. Step 2: two subjects with exam dates 2–4 weeks away; set one to High importance.
3. Step 3: upload or paste a syllabus for one subject; skip the other. Step 4: upload a past paper, and try **Find papers for me** (it works once the search key is added on the server).
4. Step 5: 2 hours a day, Sunday as a rest day. Step 6: **Build my plan**.
5. On Plan check: your name and exam countdowns; Today's list; "After …" order rules; Goals → sub-goals; Coming up; the warning for the subject without a syllabus.
6. Tick a Learn item: it's marked done in Syllabus too, and tomorrow's work does **not** jump into today. Try More → Do it tomorrow / Skip this topic / Put back.
7. Plan settings: change an exam date or hours per day; the plan and goals update at once.

**Manual checklist in Chrome, version 2.2:**
1. Reload Oris. Study → Syllabus → open a syllabus. You see **Topics** and **Exam prep** tabs. Topics works exactly as before (Search/Find videos, ticks, add topic).
2. Exam prep → **Upload papers** → pick 2–3 past papers (PDFs with selectable text). Each one shows "N questions, M matched to topics".
3. Check **Most asked topics** and **Study these first**. Click a topic bar to see its questions. Fix any wrong match with the dropdown.
4. Topics tab → a topic's **Exam** button → **Practice questions** (needs Oris AI or your Groq key) → **Show answer**.
5. Set Exam type to **Competitive** and generate again. You now get MCQs.
6. Exam prep → Mock test → Topics: **Whole syllabus**, 5 questions → **Start mock test**. Close and reopen the panel: the timer is still running. Then **Finish and mark** → mark each → **Save result**. Topics you missed show **Revise**.

**Server setup (Oris AI and paper search).** In Supabase → project *oris* → Edge Functions → Secrets:
- `NVIDIA_API_KEY` (build.nvidia.com → Generate API Key): used for all AI features when set (model `nvidia/nemotron-3.5-lightning-30b-a3b`, change with `ORIS_MODEL`). Otherwise `GROQ_API_KEY` is used.
- `SERPER_API_KEY` (serper.dev, free trial credits) or `BRAVE_API_KEY` (Brave Search API): needed for **Find papers for me**. Without one, Oris shows a plain Google search link instead.
- 3.2 adds the table `coach_events` (migration `server/supabase/migrations/20261111_coach_events.sql`, already applied to the live project). It only receives events from users who turned on "Help improve Oris".
- `YOUTUBE_API_KEY` (Google Cloud → YouTube Data API v3, free): needed for automatic lecture search and playlist import for everyone without their own key. The free quota (10,000 units a day) covers about 90 lecture searches a day across all users, so heavy users should add their own key in Settings.

**Manual checklist in Chrome, version 2.1:**
1. Reload Oris. Settings → **AI**: "Use Oris AI" is on. Remove your own Groq key for this test.
2. Research → Sources → **Research this page** on any article. You get an "AI summary" (not "Key sentences").
3. Turn "Use Oris AI" off and summarise again. You get "Key sentences" and nothing is sent.
4. Add your own Groq key back. Summaries now go straight to Groq.

**Manual checklist in Chrome, version 2.0:**
1. **Reload.** Reload Oris in `chrome://extensions` (no new permissions). Open the side panel → **Earn**. You see 5 tabs.
2. **Income.** Overview → **Add income** → ₹12,500 from "Test client" → Add. The first card shows ₹12,500 and a "badges unlocked" toast appears. Add ₹3,000 with "Already received" off; it shows under "waiting to be paid" with a **Mark received** button.
3. **Privacy.** Click **Hide amounts**. Every figure becomes ₹ •••. Click **Show amounts**.
4. **Work timer.** Work → add "Test client" with rate 800 → **Start work timer**. Wait over a minute → **Stop and log time**. The entry shows its time and value. Under a minute logs nothing (by design).
5. **Jobs.** Jobs → **Add an application** with a follow-up date of today. The card turns orange ("Follow up now") and the Overview shows "1 follow-up due". A Chrome notification arrives within the hour. **Focus on applying** starts the focus timer.
6. **Skills.** Skills → add a skill and a step → **Focus**. Let the session finish (or set focus to 1 minute in Settings); the skill shows the focus time.
7. **Rewards.** Rewards shows your level, the XP table and badges.
8. **CSV.** Overview and Work each have **Download CSV**; open it in Excel or Google Sheets.

**Manual checklist in Chrome, version 1.3:**
1. **Reload.** Reload Oris in `chrome://extensions`.
2. **Research this page.** Open a journal article that has a DOI (most ScienceDirect, Springer, Nature and PLOS pages do). Go to Research → Sources → **Research this page**. A summary appears, then a citation ending in `https://doi.org/…`.
3. **Tags.** Open the source, type `exam, chapter 2` in the tag box and press Enter. Back in Sources, click a tag chip to filter.
4. **Ask.** Open the Ask tab. If it says some sources were saved before Ask existed, click **Read those pages**. Then ask a question about your sources. With a Groq key you get an answer with numbered chips that jump to the passages.
5. **Export.** Bibliography → **Chicago** → **Export project (.md)**. Open the file in any text editor or in Notion.

**Manual checklist in Chrome, version 1.2:**
1. **Reload.** Reload Oris in `chrome://extensions` and accept the new "search" permission. Open a New Tab. Chrome asks once whether to keep the extension's New Tab page; choose **Keep it**.
2. **Onboarding.** Run setup again from Settings to see onboarding. Answer the 3 questions and check the summary matches your answers.
3. **Start focus.** Type a daily focus and press Space (click an empty area first). The arc turns into the timer and the status line shows the time left.
4. **Quick note.** Press N, type a note, press Enter. Open Study → Focus and the note is listed under "Notes for this session".
5. **Modes.** Press S. Study opens full page with a burst. Press Esc to go back.
6. **Calculator.** Dock → Calculator → `120000*18%` shows 21,600.
7. **Tasks.** In the side panel, add a task, pick it under the timer, and start. When the session ends, the task shows its focus time and the celebration plays.

**Manual checklist in Chrome, Research mode (1.1):**
1. **Reload.** Reload Oris in `chrome://extensions`. Chrome asks you to accept new permissions ("scripting" and "context menus").
2. **Save and summarise.** Open any news article → Oris → Research → Sources → **Save page**. Author, date and site should fill in. Then click **Summarise**.
3. **Highlight.** Select a sentence, then right-click and choose **Highlight with Oris**. It turns yellow and a blue "Saved to…" note appears. Reload the page and the highlight comes back.
4. **Edit a highlight.** In Oris, open the source. Change a highlight's colour (the page updates) and click **Show on page**.
5. **Bibliography.** Switch to **Bibliography**, choose MLA 9, then **Copy all** and paste into Google Docs or Word. Titles keep their italics.
6. **Sessions.** Go to **Sessions** → **Save tabs** → **Open in new window**. All your tabs reopen.

**Manual checklist in Chrome, Study mode:**
1. **Timer.** Settings → set Focus length to 1 minute → Start focus. The badge shows `1m`. After 1 minute you get a notification and the break starts.
2. **Blocker.** With "During focus" selected, start a session and open `instagram.com`. You should see the Oris blocked page with the countdown. Stop the session and the page offers "Continue to site".
3. **Open tabs.** Open `reddit.com`, then start focus. That tab switches to the blocked page.
4. **Allow-only.** Blocker → "Allow only these" + "Always". Any site not on the list is blocked.
5. **Distractions.** Open youtube.com. The home feed is replaced with a note, Shorts are gone, and on a video page the recommendations column is hidden. Open a `/shorts/…` link and it plays as a normal video.
6. **Hard mode.** Turn it on and start focus. Pause and Stop are disabled, and the blocker settings are locked.
7. **Syllabus.** Syllabus → Add syllabus → upload a syllabus PDF → Find topics. Units and topics appear. With a YouTube key, click "Find videos" on a topic.

## Files
```
manifest.json          extension config
background.js          service worker: timer, blocking rules, stats, badge, notifications
lib/                   shared logic (defaults, blocking rules, syllabus, YouTube, PDF text, research store, citations, summaries)
sidepanel/             side panel UI (app.js + one file per view; research-*.js for Research mode)
blocked/               page shown instead of a blocked site
newtab/                New Tab home: idle screen, burst, onboarding, dock (modes reuse sidepanel/ views)
content/distraction.js hides feeds/Shorts on YouTube, Instagram, Facebook, X, Reddit, LinkedIn
content/highlighter.js injected only when you highlight, or on pages that have saved highlights
styles/base.css        colours, type, buttons (light + dark)
vendor/                pdf.js 4.10 (PDF text extraction, runs locally)
fonts/                 Bricolage Grotesque (bundled, no network)
test/                  Node tests + chrome mock (not needed by Chrome)
```
