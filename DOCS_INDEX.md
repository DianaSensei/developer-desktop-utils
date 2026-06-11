# Documentation Index

Complete guide to all DevTool documentation files.

---

## 🤖 For AI Coding Agents

### Start Here

**[CLAUDE.md](CLAUDE.md)** - Primary guide for AI agents  
Complete project overview, conventions, patterns, and quick reference. Read this first to save 70-80% context gathering time.

**Contents:**
- Project structure and architecture
- Step-by-step guide to add new tools
- Shared tool hooks (persistent state, quick paste, undo/redo) and the UX conventions
- Code conventions and patterns
- Common issues and solutions
- Quick reference for components/utilities
- Cost optimization tips

**When to use**: Always read first when working on this project.

---

## 👨‍💻 For Human Developers

### Getting Started

**[README.md](README.md)** - Project overview  
Features, tech stack, quick start commands.

**[SETUP.md](SETUP.md)** - Setup instructions  
Prerequisites, installation, troubleshooting setup.

**[BUILD.md](BUILD.md)** - Build instructions  
How to build for macOS, Windows, Linux. CI/CD setup.

### Contributing

**[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guide  
How to add new tools, code examples, best practices.

**[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Problem solving  
Common errors, debugging techniques, solutions.

---

## 🏗️ Architecture & Design

**[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture  
Layer breakdown, data flow, state management, design decisions.

**Contents:**
- Component architecture
- State management flow
- Routing architecture
- Build & deployment
- Security model
- Performance considerations
- Platform-specific notes

**When to use**: Understanding system design, making architectural decisions.

---

**[LAYOUT.md](LAYOUT.md)** - UI/UX design principles  
DevUtils-inspired layout, space optimization, design philosophy.

**Contents:**
- Layout principles
- Sidebar design
- Content area optimization
- Responsive design
- Future enhancements

**When to use**: Making UI/UX decisions, layout changes.

---

## ✨ Feature Documentation

**[FEATURES.md](FEATURES.md)** - Feature toggle system  
How features work, usage, implementation, storage.

**Contents:**
- Feature toggle behavior
- Settings page
- Implementation details
- For users and developers

**When to use**: Understanding or modifying feature toggles.

---

**[SIDEBAR.md](SIDEBAR.md)** - Sidebar functionality  
Collapsible behavior, expanded/collapsed modes.

**Contents:**
- Sidebar features
- Collapse/expand behavior
- Keyboard navigation
- Persistence

**When to use**: Modifying sidebar behavior.

---

**[COLOR_PICKER.md](COLOR_PICKER.md)** - Color picker tool  
Complete documentation for the color picker feature.

**Contents:**
- Hex, RGB, CMYK, HSL support
- Pantone color library
- Conversion algorithms
- Use cases
- Technical details

**When to use**: Understanding or extending color picker.

---

## 🛠️ Tool Documentation

**[src/components/tools/README.md](src/components/tools/README.md)** - Tools overview  
List of all tools, how to add new ones, template.

**Contents:**
- Available tools
- Adding new tools
- Tool template
- Design guidelines

**When to use**: Adding or documenting tools.

---

## 📝 Project Management

**[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)** - Project summary  
What's been built, features, structure overview.

**When to use**: Quick project overview, status check.

---

## 🔍 Quick Lookup

### By Task

| Task | Documentation |
|------|---------------|
| Add a new tool | [CLAUDE.md](CLAUDE.md) (step-by-step), [CONTRIBUTING.md](CONTRIBUTING.md) |
| Fix a bug | [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [CLAUDE.md](CLAUDE.md) (common issues) |
| Understand architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Build the app | [BUILD.md](BUILD.md) |
| Setup dev environment | [SETUP.md](SETUP.md) |
| Modify UI/UX | [LAYOUT.md](LAYOUT.md), [ARCHITECTURE.md](ARCHITECTURE.md) |
| Work with features | [FEATURES.md](FEATURES.md) |
| Understand a tool | Tool-specific docs (e.g., [COLOR_PICKER.md](COLOR_PICKER.md)) |

### By Audience

**AI Coding Agents:**
1. [CLAUDE.md](CLAUDE.md) ← Start here
2. [ARCHITECTURE.md](ARCHITECTURE.md) ← Deep dive
3. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) ← When stuck

**New Contributors:**
1. [README.md](README.md) ← Overview
2. [SETUP.md](SETUP.md) ← Get started
3. [CONTRIBUTING.md](CONTRIBUTING.md) ← Add features
4. [TROUBLESHOOTING.md](TROUBLESHOOTING.md) ← Fix issues

**Experienced Developers:**
1. [ARCHITECTURE.md](ARCHITECTURE.md) ← System design
2. [CLAUDE.md](CLAUDE.md) ← Quick reference
3. Tool-specific docs ← Deep dives

**Project Maintainers:**
1. [ARCHITECTURE.md](ARCHITECTURE.md) ← Decisions
2. [BUILD.md](BUILD.md) ← Release process
3. All docs ← Keep updated

---

## 📊 Documentation Stats

- **Total docs**: 15+ files
- **AI-optimized**: 3 primary files
- **Code examples**: 50+ snippets
- **Troubleshooting entries**: 30+ issues
- **Architecture diagrams**: 5+ ASCII diagrams

---

## 🔄 Documentation Flow

### For New AI Agent Session

```
1. Read CLAUDE.md (primary context)
   ↓
2. If needed: ARCHITECTURE.md (deep understanding)
   ↓
3. If stuck: TROUBLESHOOTING.md (solutions)
   ↓
4. Task-specific: Other docs as needed
```

### For Adding New Tool

```
1. CLAUDE.md → "Adding a New Tool" section
   ↓
2. Follow step-by-step guide
   ↓
3. Reference CONTRIBUTING.md for details
   ↓
4. Check TROUBLESHOOTING.md if issues
```

### For Understanding System

```
1. README.md → Overview
   ↓
2. ARCHITECTURE.md → System design
   ↓
3. CLAUDE.md → Implementation patterns
   ↓
4. Specific docs → Deep dives
```

---

## 📖 Reading Order by Goal

### Goal: Work efficiently as AI agent
1. **[CLAUDE.md](CLAUDE.md)** - Complete guide
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** - System understanding
3. **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Problem solving

### Goal: Add new feature
1. **[CONTRIBUTING.md](CONTRIBUTING.md)** - How to contribute
2. **[CLAUDE.md](CLAUDE.md)** - Step-by-step tool guide
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Where it fits

### Goal: Fix bug
1. **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues
2. **[CLAUDE.md](CLAUDE.md)** - Code patterns
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** - System behavior

### Goal: Build & deploy
1. **[BUILD.md](BUILD.md)** - Build instructions
2. **[SETUP.md](SETUP.md)** - Prerequisites
3. **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Build issues

### Goal: Understand design
1. **[LAYOUT.md](LAYOUT.md)** - UI/UX principles
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Design decisions
3. **[FEATURES.md](FEATURES.md)** - Feature system

---

## 🎯 Documentation Principles

### For AI Agents
- ✅ Context-rich (no external lookups needed)
- ✅ Step-by-step guides (actionable)
- ✅ Code examples (copy-paste ready)
- ✅ Common patterns (reusable)
- ✅ Quick reference (fast lookup)

### For Humans
- ✅ Clear structure (easy navigation)
- ✅ Progressive disclosure (basics → advanced)
- ✅ Visual aids (diagrams, examples)
- ✅ Troubleshooting (solutions-focused)
- ✅ Up-to-date (maintained regularly)

---

## 🔄 Keeping Docs Updated

### When to Update

- ✅ Adding new tool → Update CLAUDE.md, tools/README.md
- ✅ Changing architecture → Update ARCHITECTURE.md
- ✅ New common issue → Update TROUBLESHOOTING.md
- ✅ New feature → Update FEATURES.md, README.md
- ✅ Build process change → Update BUILD.md

### Update Checklist

When making changes:
1. [ ] Update relevant .md files
2. [ ] Add code examples if applicable
3. [ ] Update troubleshooting if new issues
4. [ ] Update date at bottom of file
5. [ ] Check cross-references still valid

---

## 📞 Getting Help

Can't find what you need?

1. **Search all docs**: Use Cmd+F / Ctrl+F
2. **Check index**: This file lists everything
3. **Read TROUBLESHOOTING.md**: Common issues
4. **Check code comments**: Inline documentation
5. **Ask maintainers**: Open an issue

---

## 📈 Future Documentation

Planned additions:
- [ ] API documentation (if backend added)
- [ ] Plugin system guide (if implemented)
- [ ] Internationalization guide (if added)
- [ ] Performance optimization guide
- [ ] Security best practices
- [ ] Testing guide (when tests added)

---

*Last updated: 2026-06-12*  
*Maintained by: Project team*  
*For: AI agents, developers, contributors*
