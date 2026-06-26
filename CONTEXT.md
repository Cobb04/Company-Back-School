# Return School Planner

This context describes the domain language for helping an off-site intern decide how to return to school for final exams. It covers travel constraints, train suitability, return plans, leave suggestions, and the boundary between deterministic decisions and generated wording.

## Language

**Intern**:
A student currently working away from campus who needs to return to school for an exam or defense.
_Avoid_: User, employee, passenger

**Clock-out Time** (下班时间):
The time the intern finishes work and can leave the company.
_Avoid_: Off-work time, departure time, end time

**Company-to-Station Time** (公司到高铁站时间):
The travel time in minutes from the intern's workplace to the departure train station. Phase 0 is user-entered; Phase 1 will be auto-filled by a Maps MCP call.
_Avoid_: Commute time, transit time

**Earliest Exam** (最早考试时间):
The date and time of the first exam the intern needs to take after returning to school.
_Avoid_: First exam, exam time, test time

**Departure City** (出发城市):
The city the intern is currently in. The system expands it to all known train stations in that city (e.g. "上海" → 上海虹桥, 上海站, 上海南站) and searches all of them.
_Avoid_: From station, starting station

**Destination City** (目的城市):
The city closest to the intern's school. The system expands it to all known train stations in that city (e.g. "烟台" → 烟台站, 烟台南站).
_Avoid_: To station, arrival station

**City-Station Mapping** (城站映射):
A lookup that maps a city name to its list of train stations. Phase 0 uses a hardcoded mapping for supported cities; Phase 1 could pull from 12306-mcp.

**Return Plan**:
A complete suggested way for the intern to get back to school, including a chosen train, schedule summary, risks, leave suggestion, checklist, and optional leave message.
_Avoid_: Itinerary, route, travel plan

**Train Candidate**:
A train returned from the ticket source before suitability has been assessed for the intern's constraints.
_Avoid_: Train, result, option

**Scored Train**:
A train candidate after deterministic scoring has assigned score, risk level, decision, reasons, estimated school arrival time, and exam buffer.
_Avoid_: Rated train, recommendation

**Safe Departure Time**:
The earliest train departure time that respects clock-out time, company-to-station time, station-entry buffer, and risk buffer.
_Avoid_: Earliest departure, recommended departure time, safe time

**School Arrival Time**:
The estimated time the intern reaches school after the train arrives at the destination station and station-to-school travel time is added.
_Avoid_: Arrival time, destination time

**Exam Buffer**:
The time between school arrival time and the first exam time. It may be negative if the intern would arrive after the exam starts.
_Avoid_: Rest time, spare time, cushion

**Comfort Level** (舒适度):
The comfort classification derived from train type. G (高铁) and D (动车) are `comfortable`; K (普快) is `uncomfortable`. Other train types default to `unknown` until classified.
_Avoid_: Seat class, train grade

**Station Entry Guide** (极速进站攻略):
Community-sourced guide for the fastest entry route at a specific station — which gate, which path, and how many minutes minimum. Sourced from Xiaohongshu via XHS-Downloader MCP.
_Avoid_: Speed guide, station tips, entry trick

**Extreme Speed Mode** (极速冒险版):
An optional, non-recommended mode where the intern accepts higher risk for faster station entry. When active: risk buffer drops to 5 minutes, station entry buffer is replaced by the XHS-sourced entry time (typically 5–10 minutes). Marked as "不推荐" in the UI.
_Avoid_: Speed run mode, risky mode, fast track

**Risk Level**:
The risk classification assigned to a scored train: low, medium, or high.
_Avoid_: Risk, danger level

**Decision**:
The product's deterministic recommendation category for a scored train: recommend, optional, or not recommended.
_Avoid_: Status, label, bucket

**Two-Pass Scoring** (两轮评分):
The leave suggestion strategy. Pass 1 scores trains departing after Safe Departure Time (no leave needed). If the best score falls below threshold, Pass 2 expands the departure window earlier, allowing trains that would require leaving work early. If Pass 2 finds a meaningfully better train, the system recommends taking leave and shows how much earlier the intern needs to go.
_Avoid_: Threshold-based leave, fixed leave rules

**Leave Suggestion**:
The product's advice on whether the intern should ask for time off work to reduce exam-return risk.
_Avoid_: Leave plan, absence advice

**Leave Message** (请假文案):
LLM-generated natural wording the intern sends to a mentor/manager to request leave. Built from: XHS-sourced leave-request templates + intern-provided recipient name (称呼) + selected reason (生病/考试/组会/家庭原因 etc.) + train facts from deterministic scoring. The LLM personalises tone and wording without fabricating train details.
_Avoid_: Leave suggestion, request text, auto-generated message

**Checklist**:
A set of preparation items the intern should complete before and during the return trip.
_Avoid_: Todo list, tasks

**Ticket Source**:
The trusted source of train availability and price data. In this project, train facts come from 12306-mcp.
_Avoid_: LLM, train API, source

**Preference** (偏好):
The intern's trade-off priority when choosing a return plan. Three modes:
- `price_sensitive` — prefer cheaper tickets, accept longer travel time
- `time_sensitive` — prefer faster arrival, accept higher price
- `balanced` — weight price and time equally, no strong preference
_Avoid_: Stable, less_leave, cheap, easy

**Expression Layer**:
Generated natural-language output that explains existing deterministic results or turns them into copy-ready wording.
_Avoid_: LLM decision layer, AI planner
