import { LitElement, html, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { live } from 'lit/directives/live.js';
import { displayPitchClass, SCALES, exportFilename } from '../core';
import type { Editor } from '../core';
import { icons } from '../elements/icons';
import { pickMidiFile, requestMidiExport } from '../elements/midi-io';
import { tokens } from '../elements/tokens';
import { allowClicksThroughClosingPopover, showEditorToast } from '../elements/zest';
import { downloadProject, parseProject, projectFilename } from './project-file';
import {
  folderPermission, listFolderProjects, loadProjectFolder, openFolderProject, projectFolderPicker,
  rememberProjectFolder, saveFolderProject, type ProjectFolder,
} from './project-folder';
import type { Projects } from './projects';
import projectStyles from './project-menu.css?raw';

type PopoverT = HTMLElement & { isOpen: boolean };
type SearchInputT = HTMLElement & { focus: () => void };
type ProjectEntryT = Projects['entries'][number];

const formatEdited = (stamp?: number) => {
  if (!stamp) return '';
  const now = new Date();
  const date = new Date(stamp);
  const hours = Math.max(0, Math.floor((now.getTime() - stamp) / 3_600_000));
  const isToday = date.toDateString() === now.toDateString();
  const isRecent = hours === 0;
  if (isRecent) return 'Now';
  if (isToday) return `${hours}h ago`;
  now.setDate(now.getDate() - 1);
  const wasYesterday = date.toDateString() === now.toDateString();
  if (wasYesterday) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
};

@customElement('maddie-project-menu')
export class MaddieProjectMenu extends LitElement {
  static styles = [tokens, unsafeCSS(projectStyles)];

  @property({ attribute: false }) projects?: Projects;
  @property({ attribute: false }) editor?: Editor;
  @state() private draft: string | null = null;
  @state() private screen: 'menu' | 'library' | 'folder' = 'menu';
  @state() private query = '';
  @state() private folder?: ProjectFolder;
  @state() private folderReady = false;
  @state() private folderFiles: string[] = [];
  @state() private folderBusy = false;
  @state() private replaceFile?: string;
  private restoredFolder = false;
  private folderSources = new Map<string, string>();
  private unsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.subscribe();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    const didChange = changed.has('projects');
    if (didChange) this.subscribe();
  }

  private subscribe = () => {
    this.unsubscribe?.();
    this.unsubscribe = this.projects?.onChange(() => this.requestUpdate());
  };

  private close = () => {
    const popover = this.renderRoot.querySelector<PopoverT>('z-popover');
    if (popover) popover.isOpen = false;
  };

  private commit = () => {
    const projects = this.projects;
    const value = this.draft?.trim();
    this.draft = null;
    const shouldSave = Boolean(value) && value !== projects?.current.name;
    if (shouldSave && value) projects?.save(value);
  };

  private handleNameKey = (event: KeyboardEvent) => {
    const isCancel = event.key === 'Escape';
    const isCommit = event.key === 'Enter';
    if (isCancel) this.draft = null;
    if (!isCommit) return;
    event.preventDefault();
    this.commit();
    (event.composedPath()[0] as HTMLElement).blur();
  };

  private toggle = (event: CustomEvent<{ open: boolean }>) => {
    const isOwnEvent = event.target === event.currentTarget;
    if (!isOwnEvent) return;
    const isOpen = event.detail.open;
    if (isOpen) this.projects?.refreshLibrary();
    if (!isOpen) this.commit();
    this.query = '';
    this.screen = 'menu';
    this.replaceFile = undefined;
  };

  private showLibrary = () => {
    this.screen = 'library';
    void this.updateComplete.then(() => this.renderRoot.querySelector<SearchInputT>('.project-search')?.focus());
  };

  private hideLibrary = () => {
    this.screen = 'menu';
    this.query = '';
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.open-project')?.focus());
  };

  private pickProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.maddie,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file || !this.projects) return;
      try {
        const project = parseProject(await file.text());
        this.projects.importProject(project);
        showEditorToast('Opened ' + project.name);
      } catch (error) {
        showEditorToast((error as Error).message);
      }
    }, { once: true });
    input.click();
  };

  private showFolder = () => {
    this.commit();
    this.screen = 'folder';
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.folder-back')?.focus());
    void this.folderAction("Couldn't read the project folder.", async () => {
      if (!this.restoredFolder) {
        this.folder = await loadProjectFolder().catch(() => undefined);
        this.restoredFolder = true;
      }
      await this.refreshFolder();
    });
  };

  private hideFolder = () => {
    this.screen = 'menu';
    this.replaceFile = undefined;
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.open-folder')?.focus());
  };

  private async folderAction(message: string, run: () => Promise<void>) {
    if (this.folderBusy) return;
    this.folderBusy = true;
    try {
      await run();
    } catch (error) {
      const permissionLost = error instanceof DOMException && error.name === 'NotAllowedError';
      if (permissionLost) {
        this.folderReady = false;
        this.folderFiles = [];
      }
      showEditorToast(permissionLost ? 'Allow access to the project folder and try again.' : message);
    } finally {
      this.folderBusy = false;
    }
  }

  private async refreshFolder() {
    const folder = this.folder;
    this.folderReady = Boolean(folder && await folderPermission(folder) === 'granted');
    this.folderFiles = this.folderReady && folder ? await listFolderProjects(folder) : [];
  }

  private chooseFolder = () => {
    const pick = projectFolderPicker();
    if (!pick) return;
    void this.folderAction("Couldn't connect to that folder. Choose a project folder and try again.", async () => {
      let folder: ProjectFolder;
      try {
        folder = await pick();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        throw error;
      }
      this.folder = folder;
      this.folderReady = false;
      this.folderFiles = [];
      this.folderSources.clear();
      this.replaceFile = undefined;
      await rememberProjectFolder(folder).catch(() => showEditorToast('Folder access is available for this session.'));
      await this.refreshFolder();
    });
  };

  private allowFolder = () => {
    const folder = this.folder;
    if (!folder) return;
    void this.folderAction("Couldn't access the project folder.", async () => {
      if (await folderPermission(folder, true) !== 'granted') {
        showEditorToast('Folder permission was declined.');
        return;
      }
      await this.refreshFolder();
    });
  };

  private disconnectFolder = () => {
    void this.folderAction("Couldn't forget the project folder.", async () => {
      await rememberProjectFolder(null);
      this.folder = undefined;
      this.folderReady = false;
      this.folderFiles = [];
      this.folderSources.clear();
      this.replaceFile = undefined;
    });
  };

  private openFromFolder = (filename: string) => {
    const { folder, projects } = this;
    if (!folder || !projects) return;
    void this.folderAction(`Couldn't open ${filename}.`, async () => {
      const project = await openFolderProject(folder, filename);
      projects.importProject(project);
      this.folderSources.set(projects.activeId, filename);
      this.close();
      showEditorToast('Opened ' + project.name);
    });
  };

  private saveToFolder = (replace = false) => {
    const { folder, projects } = this;
    if (!folder || !projects) return;
    const project = projects.snapshot();
    const filename = this.folderSources.get(projects.activeId) ?? projectFilename(project.name);
    if (replace && this.replaceFile !== filename) return;
    void this.folderAction(`Couldn't save ${filename}.`, async () => {
      const result = await saveFolderProject(folder, filename, project, replace);
      this.replaceFile = result === 'exists' ? filename : undefined;
      if (result === 'saved') {
        showEditorToast('Saved ' + filename);
        await this.refreshFolder().catch(() => showEditorToast('Saved the project, but the folder list could not be refreshed.'));
      }
    });
  };

  private renderEntry = (projects: Projects, entry: ProjectEntryT) => {
    const isCurrent = entry.id === projects.activeId;
    const doc = entry.file.doc;
    const bpm = doc.tempo[0]?.bpm ?? 120;
    const key = doc.key ? `${displayPitchClass(doc.key.root)} ${SCALES[doc.key.scale].name.toLowerCase()}` : 'No key';
    const open = () => {
      this.close();
      if (isCurrent) return;
      projects.open(entry.id);
      const didOpen = projects.activeId === entry.id;
      if (didOpen) showEditorToast('Opened ' + entry.file.name);
    };
    const time = isCurrent ? html`<span class="current">Open</span>` : formatEdited(entry.file.updatedAt);
    const name = entry.file.name;

    return html`<button type="button" class="project-row" aria-current=${isCurrent} @click=${open}>
      <span class="project-name">${name}<span class="muted">${bpm} BPM · ${key}</span></span>
      <span class="muted">${time}</span>
    </button>`;
  };

  private renderLibrary = (projects: Projects) => {
    const query = this.query.trim().toLowerCase();
    const matches = projects.entries.filter((entry) => entry.file.name.toLowerCase().includes(query));
    const hasMatches = matches.length > 0;
    const entries = hasMatches ? matches.map((entry) => this.renderEntry(projects, entry)) : html`<p>No projects match.</p>`;
    const setQuery = (event: CustomEvent<{ value: string }>) => { this.query = event.detail.value; };

    // TODO(design): Add project-row delete and duplicate when specified.
    return html`<div class="projects-header">
      <z-tooltip content="Back to project menu" placement="bottom">
        <z-button is-icon size="xs" kind="ghost" aria-label="Back to project menu" @click=${this.hideLibrary}>${icons.back}</z-button>
      </z-tooltip><strong>Projects</strong>
    </div>
    <z-input class="project-search" aria-label="Search projects" type="search" size="sm"
      placeholder="Search projects" .value=${live(this.query)} @input=${setQuery}></z-input>
    <z-scroll-area class="project-list">${entries}</z-scroll-area>
    <p class="project-footer">Projects are saved in this browser. Export one to back it up.</p>`;
  };

  private renderFolder = () => {
    const busy = this.folderBusy;
    const filename = this.replaceFile;
    return html`<div class="projects-header">
      <z-tooltip content="Back to project menu" placement="bottom">
        <z-button class="folder-back" is-icon size="xs" kind="ghost" aria-label="Back to project menu" @click=${this.hideFolder}>${icons.back}</z-button>
      </z-tooltip><strong>Local project folder</strong>
    </div>
    ${this.folder ? html`<p class="folder-caption" title=${this.folder.name}>${this.folder.name}</p>` : nothing}
    ${this.folderReady ? html`
      <button class="project-action" ?disabled=${busy || Boolean(filename)} type="button" @click=${() => this.saveToFolder()}>Save project here<span>.maddie</span></button>
      ${filename ? html`<div class="folder-replace">
        <p role="status">Replace ${filename}?</p>
        <button class="project-action" ?disabled=${busy} type="button" @click=${() => this.saveToFolder(true)}>Replace file</button>
        <button class="project-action" ?disabled=${busy} type="button" @click=${() => { this.replaceFile = undefined; }}>Cancel</button>
      </div>` : nothing}
      <z-separator></z-separator>
      <z-scroll-area class="folder-list" aria-label="Projects in folder">
        ${this.folderFiles.map((name) => html`<button class="project-row" ?disabled=${busy || Boolean(filename)} type="button" title=${name}
          @click=${() => this.openFromFolder(name)}><span class="project-name">${name}</span></button>`)}
        ${!this.folderFiles.length && !busy ? html`<p>No .maddie files in this folder.</p>` : nothing}
      </z-scroll-area>
    ` : this.folder ? html`
      <button class="project-action" ?disabled=${busy} type="button" @click=${this.allowFolder}>Allow folder access</button>
    ` : html`<p class="folder-caption">Choose or create a folder for your .maddie files.</p>`}
    ${busy ? html`<p class="folder-caption" role="status">Working…</p>` : nothing}
    <div class="folder-footer">
      <button class="project-action" ?disabled=${busy} type="button" @click=${this.chooseFolder}>${this.folder ? 'Change folder…' : 'Choose folder…'}</button>
      ${this.folder ? html`<button class="project-action" ?disabled=${busy} type="button" @click=${this.disconnectFolder}>Forget folder</button>` : nothing}
    </div>`;
  };

  private renderMain = (projects: Projects, ed: Editor) => {
    const name = this.draft ?? projects.current.name;
    const setDraft = (event: CustomEvent<{ value: string }>) => { this.draft = event.detail.value; };
    const action = (run: () => void) => () => {
      this.commit();
      this.close();
      run();
    };
    const newProject = action(() => projects.newProject());
    const importProject = action(this.pickProject);
    const importMidi = action(() => pickMidiFile(ed, this));
    const exportProject = action(() => {
      void downloadProject(projects.snapshot()).catch(() => showEditorToast("Couldn't export the project."));
    });
    const exportMidi = action(() => { void requestMidiExport(ed.doc, exportFilename(ed.doc), this, undefined, true); });
    const hasError = Boolean(projects.storageError);
    const isSaving = projects.isSaving;
    let status = html`<span class="success">${icons.check}</span>Saved in this browser`;
    if (isSaving) status = html`Saving…`;
    if (hasError) status = html`<span class="error" aria-hidden="true">!</span>Couldn't save — export to keep a copy`;

    return html`<div class="name-field">
      <z-input size="sm" aria-label="Project name" .value=${live(name)} @input=${setDraft}
        @keydown=${this.handleNameKey} @focusout=${this.commit}></z-input>
      <p role="status" class="save-status">${status}</p>
    </div>
    <z-separator></z-separator>
    <button class="project-action" type="button" @click=${newProject}>New project</button>
    <button class="project-action open-project" type="button" @click=${this.showLibrary}>Open project…<span aria-hidden="true">›</span></button>
    ${projectFolderPicker() ? html`<button class="project-action open-folder" type="button" @click=${this.showFolder}>Local project folder…<span aria-hidden="true">›</span></button>` : nothing}
    <z-separator></z-separator>
    <button class="project-action" type="button" @click=${importProject}>Import project…<span>.maddie</span></button>
    <button class="project-action" type="button" @click=${importMidi}>Import MIDI…<span>.mid</span></button>
    <z-separator></z-separator>
    <button class="project-action" type="button" @click=${exportProject}>Export project…<span>.maddie</span></button>
    <button class="project-action" type="button" @click=${exportMidi}>Export MIDI…<span>.mid</span></button>`;
  };

  protected render = () => {
    const projects = this.projects;
    const ed = this.editor;
    if (!projects || !ed) return nothing;
    const name = this.draft ?? projects.current.name;
    const panel = this.screen === 'folder' ? this.renderFolder() :
      this.screen === 'library' ? this.renderLibrary(projects) : this.renderMain(projects, ed);

    return html`<z-popover ${ref(allowClicksThroughClosingPopover)} placement="bottom-start" offset="6" aria-label="Project" @toggle=${this.toggle}>
      <z-button slot="trigger" kind="ghost" size="md" title=${name}>
        <span class="mark" aria-hidden="true"></span><span class="name">${name}</span>${icons.chevron}
      </z-button>
      <div class="panel">${panel}</div>
    </z-popover>`;
  };
}
