I want to work on a visulisation of our TODO.md for the user to easier interact with it. Right now its fine to edit markdown files but for the user it is in generanl not human friendly and does not gives a great reading and progress tracking flow. I would like to understand other options better to have a more human way of working with it.

Humans typically fill or tick boxes and don’t mess too much with syntax or something. I thought about a VSCode extension which lets you see sections (collapse and expandable) as presented in the TODO.md (New => Backlog => In Progress  ( <=> Feedback - if feedback is required) => Review => Done (DONE.md)).

It sohuld be easy to see what is currently getting worked on and if feedback is required - what feedback. Also it should be optimised with Claude code and therefore should also offer the possibility to define which model to use.

UI:
I would somewhat expect a full page if you click on the extension icon. It should open a page where you have on the left the phases (New, Backlog etc. - 25% of the screen ) and the rest 75% show the actual tasks with a title, Description and tasks done in a order. All of those should be fields which can be edited and then on save written back to the TODO.md.

The open question / feedback area should also have a field for the question (not editable) but a editable one below it to fill in the answer for the question. Also there should be a field which is open text to ask questions or let the story be modified. If you want to create a new story it should be one big box which then on save gets written to the “New” field and then gets populated by an agent. No stricter human interaction should be required to create a story.

The UI should be clean but also modern with a nice flow. It should also give you states if something requires your attention. Like a little blinking extension icon which then also indicates where to look for (New, Backlog etc.).

I want to keep the extension as simple as possible code wise and the base should stay maintainable without a lot of dependencies (like node.js). I had good experience with php, js & html/css - doable to do it that way? Just an idea please also elaborate on what you would use.

Additional features:
Since we are mostly running this with a loop in each Claude terminal it would be nice to also be able to spawn a new claude code terminal and run it with auto mode enabled by default. Then inject in that named claude code terminal e.g. “Claude Sonnet”,  “Claude Opus” or “Claude Fable” a loop to check the TODO.md for tasks for either model specific or if not defined which model to use the default one (currently Opus).
