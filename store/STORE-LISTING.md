# Oris: Chrome Web Store listing (copy and paste)

## Package
Upload `oris-3.2.0.zip`. It contains only what Chrome needs, with no tests and no dev files.

## Store listing tab

**Name** (taken from the package): Oris – Focus for Study, Research & Earning

**Summary** (taken from the package, 112 of 132 characters):
Focus timer, site blocker, AI summaries, citations, income and job tracking. All in your New Tab and side panel.

**Category:** Productivity → Education
**Language:** English

**Description:**

Oris is a calm focus home for students and early-career earners. It replaces your New Tab and lives in Chrome’s side panel, with three modes.

STUDY PLAN
• A 3-minute setup: your class or college, subjects, exam dates, syllabus and past papers
• Oris plans every day up to your exams, with most-asked and highest-marks topics first, prerequisites before the topics that need them, revision and a mock test before each exam
• Goals and weekly sub-goals per subject; move, shorten or skip anything and the plan adapts instantly
• Find past papers: Oris searches the web (official sites first) and reads the paper you pick

AI COACH
• Notices when a topic keeps slipping and splits it into smaller parts, lightens overfull days, or adds more when you finish early
• Learns from the tips you accept or dismiss, on your device
• A weekly review of your study and at most one gentle reminder a day

LECTURES
• A lecture playlist for every subject, in study order. Oris finds the best lecture per topic, or import a full-course playlist
• A distraction-free player: timestamped notes, sticky notes on the timeline, speed, A–B loop, resume
• Practice questions after each lecture and points for finishing lectures and beating your best score

STUDY
• Focus timer with short and long breaks, sessions and streaks
• Blocks distracting sites during focus (or all the time, or on a schedule)
• Hides feeds, Shorts and Reels on YouTube, Instagram, Facebook, X, Reddit and LinkedIn
• Today’s focus, tasks and quick notes linked to each session
• Upload a syllabus (PDF or text). Oris turns it into units and topics and finds YouTube lectures for each one
• Exam prep: upload previous-year papers (PYQs) and see the most-asked topics, every past question by topic and what to study first
• AI practice questions (written or MCQ) and timed mock tests that flag topics to revise

RESEARCH
• “Research this page”: one click saves the page, writes a summary and makes the citation
• Citations in APA, MLA, Chicago and IEEE, with DOI links
• Highlight text on any page and the highlights come back when you return
• Projects, tags and research sessions
• Ask: ask a question and get an answer from only your saved sources, with links to the passages
• Export a bibliography or the whole project as Markdown

EARN
• Log income, see this month and the last 6 months, and find your real earnings per client hour
• Work timer per client or project, with hourly rates
• Job, internship and gig tracker with follow-up reminders
• Skill paths with steps, course links and focus time
• Levels and badges earned only from real work
• “Hide amounts” for screen sharing, plus CSV export

AI INCLUDED
Oris AI works out of the box with a free daily allowance. Add your own free Groq key for unlimited use, or turn AI off and Oris uses built-in methods.

PRIVATE BY DESIGN
No account, no ads, no tracking. Your data stays in your browser. Text leaves your device only when you use an AI feature, and it isn’t stored.

Keyboard: Alt+Shift+O start or pause focus · Alt+Shift+H highlight · Alt+Shift+N quick note

**Screenshots** (1280×800, in this order):
1. screenshot-1-newtab.png
2. screenshot-2-study.png
3. screenshot-3-research.png
4. screenshot-4-earn.png
5. screenshot-5-jobs.png

**Small promo tile** (440×280): promo-small-440x280.png
**Store icon** (128×128): icons/icon128.png from the extension folder

## Privacy practices tab

**Single purpose:**
Oris helps students and early-career workers focus on study, research and paid work: a focus timer with site blocking, research tools for saving, summarising and citing pages, and trackers for income, client hours, job applications and skills.

**Permission justifications:**
- **storage**: Saves the user’s tasks, notes, timer, research sources and Earn data on their device.
- **unlimitedStorage**: Saved research sources keep the page text for Ask and summaries, which can exceed the default 10 MB limit.
- **alarms**: Ends focus and break sessions on time and checks job follow-up dates and the study coach reminder, even when the side panel is closed.
- **notifications**: Tells the user when a session ends and when a job follow-up is due, and sends at most one study reminder a day (can be turned off).
- **declarativeNetRequest**: Redirects sites on the user’s block list to the Oris “blocked” page during focus.
- **sidePanel**: Oris’s main interface runs in Chrome’s side panel next to the page.
- **tabs**: Reads the active tab’s title and URL so the user can save it as a research source and see whether it’s already saved.
- **tabs** also opens the Oris lecture player in a new tab.
- **scripting**: Injects the highlighter and reads a page’s text only when the user clicks “Research this page”, “Highlight with Oris” or a shortcut.
- **contextMenus**: Adds “Highlight with Oris” and “Save page to Oris” to the right-click menu.
- **search**: The New Tab search box sends the query to the user’s default search engine.
- **Host permission (all sites)**: Needed to block or redirect any site the user adds to their block list, to restore saved highlights on any page they research, and to read the page they choose to save. A content script runs only on 7 social sites to hide feeds and Shorts.
- **Remote code**: No, Oris doesn’t use remote code. All JavaScript is in the package. The Oris AI server returns only text (JSON).

**Data usage** (tick these):
- ✅ **Website content**: page text is sent for AI summaries or Ask only when the user asks.
- ✅ **User activity**: only if the user turns on “Help improve Oris” (off by default), anonymous study-plan events (action kind, day, hour, level) are sent once a day. No names, topics or notes.
- Leave everything else unticked: personally identifiable information, health, financial and payment information (Earn entries stay on the device and are never transmitted), authentication, personal communications, location and web history.

Certify all three:
- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases
- ✅ I do not use or transfer user data for purposes that are unrelated to my item’s single purpose
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** your GitHub Pages link (see the steps)

## Distribution tab
Free · Visibility: Public (or Unlisted for a soft launch) · Regions: All
