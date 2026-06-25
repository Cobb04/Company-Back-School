# Return School Planner

This context describes the domain language for helping an off-site intern decide how to return to school for final exams. It covers travel constraints, train suitability, return plans, leave suggestions, and the boundary between deterministic decisions and generated wording.

## Language

**Intern**:
A student currently working away from campus who needs to return to school for an exam or defense.
_Avoid_: User, employee, passenger

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
The earliest train departure time that respects off-work time, commute time to the station, station-entry buffer, and risk buffer.
_Avoid_: Earliest departure, recommended departure time, safe time

**School Arrival Time**:
The estimated time the intern reaches school after the train arrives at the destination station and station-to-school travel time is added.
_Avoid_: Arrival time, destination time

**Exam Buffer**:
The time between school arrival time and the first exam time. It may be negative if the intern would arrive after the exam starts.
_Avoid_: Rest time, spare time, cushion

**Risk Level**:
The risk classification assigned to a scored train: low, medium, or high.
_Avoid_: Risk, danger level

**Decision**:
The product's deterministic recommendation category for a scored train: recommend, optional, or not recommended.
_Avoid_: Status, label, bucket

**Leave Suggestion**:
The product's advice on whether the intern should ask for time off work to reduce exam-return risk.
_Avoid_: Leave plan, absence advice

**Leave Message**:
Copy-ready wording the intern can send to a mentor or manager when asking for leave.
_Avoid_: Leave suggestion, request text

**Checklist**:
A set of preparation items the intern should complete before and during the return trip.
_Avoid_: Todo list, tasks

**Ticket Source**:
The trusted source of train availability and price data. In this project, train facts come from 12306-mcp.
_Avoid_: LLM, train API, source

**Expression Layer**:
Generated natural-language output that explains existing deterministic results or turns them into copy-ready wording.
_Avoid_: LLM decision layer, AI planner
