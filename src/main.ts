import {
	Modal,
	Notice,
	Plugin,
	Setting,
	requestUrl,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
				// Our new command: opens a popup asking for a paper URL
		this.addCommand({
			id: 'add-paper',
			name: 'Add paper',
			callback: () => {
				new AddPaperModal(this.app).open();
			},
		});

		// Ribbon icon in the left panel — opens the Add paper popup
		this.addRibbonIcon('book-plus', 'Add paper', () => {
			new AddPaperModal(this.app).open();
		});

		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AddPaperModal extends Modal {
	url = '';

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Add paper' });

		new Setting(contentEl)
			.setName('Paper URL')
			.addText((text) =>
				text
					.setPlaceholder('https://arxiv.org/abs/...')
					.onChange((value) => {
						this.url = value;
					}),
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Add')
				.setCta()
				.onClick(async () => {
					if (!this.url) {
						new Notice('Please paste a URL first');
						return;
					}
					await this.addPaper(this.url);
					this.close();
				}),
		);
	}

	// Fetch the page, derive a title + slug, and write the note
	async addPaper(url: string) {
		new Notice('Fetching…');

		// 1. Fetch the page HTML (requestUrl bypasses CORS)
		let title = 'Untitled';
		let abstract = '';
		let authors: string[] = [];
		try {
			const res = await requestUrl({ url });
			// Pull the <title>...</title> text from the HTML
			const match = res.text.match(/<title[^>]*>([^<]*)<\/title>/i);
			if (match && match[1]) title = match[1].trim();
			// Also try to grab the abstract
			abstract = this.extractAbstract(res.text);
			authors = this.extractAuthors(res.text);
		} catch (e) {
			new Notice('Could not fetch page; using fallback name');
		}

		// 2. Make a short slug from the title
		const slug = this.makeSlug(title);

		// 3. Ensure the Papers/ folder exists
		const folder = 'Papers';
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// 4. Build the note content
		const today = new Date().toISOString().slice(0, 10);
		const body = [
			'---',
			`url: ${url}`,
			`title: "${title.replace(/"/g, "'")}"`,
			`authors: [${authors.map((a) => `"${a.replace(/"/g, "'")}"`).join(', ')}]`,
			'status: unread',
			'tags: [paper]',
			'---',
			'',
			`# ${title}`,
			'',
			`Added on ${today}`,
			'',
			'## Abstract',
			'',
			abstract || '_No abstract found — check the link._',
			'',
		].join('\n');

		// 5. Create the file (avoid overwriting if it already exists)
		let path = `${folder}/${slug}.md`;
		if (this.app.vault.getAbstractFileByPath(path)) {
			path = `${folder}/${slug}-${Date.now()}.md`;
		}
		await this.app.vault.create(path, body);

		new Notice(`Saved: ${path}`);
	}

	// Turn a title into a short slug: take text before ':' if present,
	// otherwise the first few words. Strip characters unsafe in filenames.
	makeSlug(title: string): string {
		const base = (title.includes(':')
			? title.split(':')[0]
			: title.split(/\s+/).slice(0, 3).join(' ')) ?? '';
		const clean = base.replace(/[\\/:*?"<>|]/g, '').trim();
		return clean || 'paper';
	}

	// Try to pull the abstract from common academic meta tags
	extractAbstract(html: string): string {
		// Ordered list of places to look, best first
		const patterns = [
			/<meta[^>]*name=["']citation_abstract["'][^>]*content=["']([^"']*)["']/i,
			/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
			/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
		];
		for (const re of patterns) {
			const m = html.match(re);
			if (m && m[1] && m[1].trim().length > 40) {
				return this.decodeEntities(m[1].trim());
			}
		}
		return '';
	}

	// Collect all citation_author meta tags
	extractAuthors(html: string): string[] {
		const re = /<meta[^>]*name=["']citation_author["'][^>]*content=["']([^"']*)["']/gi;
		const authors: string[] = [];
		let m;
		while ((m = re.exec(html)) !== null) {
			if (m[1]) authors.push(this.decodeEntities(m[1].trim()));
		}
		return authors;
	}

	// Convert HTML entities like &amp; &lt; &#39; back to normal characters
	decodeEntities(text: string): string {
		const el = document.createElement('textarea');
		el.innerHTML = text;
		return el.value;
	}

	onClose() {
		this.contentEl.empty();
	}
}