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

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		// Command: opens a popup asking for a paper URL or DOI
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

		// Settings tab
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
			.setName('Paper URL or DOI')
			.addText((text) =>
				text
					.setPlaceholder('https://arxiv.org/abs/... or 10.1016/...')
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
						new Notice('Please paste a URL or DOI first');
						return;
					}
					await this.addPaper(this.url);
					this.close();
				}),
		);
	}

	// Fetch metadata (via scrape or Crossref), derive a slug, and write the note
	async addPaper(url: string) {
		new Notice('Fetching…');

		let title = 'Untitled';
		let abstract = '';
		let authors: string[] = [];
		let doi = '';
		let html = '';

		// 1. If the user pasted a DOI (not a normal URL), go straight to Crossref
		const doiInput = this.asDoiInput(url);
		if (doiInput) {
			doi = doiInput;
			const cr = await this.fetchCrossref(doi);
			if (cr.title) title = cr.title;
			if (cr.authors.length) authors = cr.authors;
			if (cr.abstract) abstract = cr.abstract;
			// Use the canonical doi.org URL as the note's link
			url = `https://doi.org/${doi}`;
		}

		// 2. Otherwise scrape the page
		if (!doiInput) {
			try {
				const res = await requestUrl({ url });
				html = res.text;
				const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
				if (match && match[1]) title = match[1].trim();
				abstract = this.extractAbstract(html);
				authors = this.extractAuthors(html);
			} catch (e) {
				new Notice('Could not fetch page; trying Crossref…');
			}

			// 3. If scraping left gaps, try Crossref by DOI
			doi = this.extractDOI(url, html);
			if (
				doi &&
				(!abstract || authors.length === 0 || title === 'Untitled')
			) {
				const cr = await this.fetchCrossref(doi);
				if (cr.title && title === 'Untitled') title = cr.title;
				if (authors.length === 0) authors = cr.authors;
				if (!abstract && cr.abstract) abstract = cr.abstract;
			}
		}

		// 4. Make a short slug from the title
		const slug = this.makeSlug(title);

		// 5. Ensure the Papers/ folder exists
		const folder = 'Papers';
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// 6. Build the note content
		const today = new Date().toISOString().slice(0, 10);
		const body = [
			'---',
			`url: ${url}`,
			`title: "${title.replace(/"/g, "'")}"`,
			`doi: ${doi}`,
			`authors: [${authors
				.map((a) => `"${a.replace(/"/g, "'")}"`)
				.join(', ')}]`,
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

		// 7. Create the file (avoid overwriting if it already exists)
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
		const base =
			(title.includes(':')
				? title.split(':')[0]
				: title.split(/\s+/).slice(0, 3).join(' ')) ?? '';
		const clean = base.replace(/[\\/:*?"<>|]/g, '').trim();
		return clean || 'paper';
	}

	// Try to pull the abstract from common academic meta tags
	extractAbstract(html: string): string {
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
		const re =
			/<meta[^>]*name=["']citation_author["'][^>]*content=["']([^"']*)["']/gi;
		const authors: string[] = [];
		let m;
		while ((m = re.exec(html)) !== null) {
			if (m[1]) authors.push(this.decodeEntities(m[1].trim()));
		}
		return authors;
	}

	// Find a DOI from the URL or page HTML
	extractDOI(url: string, html: string): string {
		const doiRe = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
		// 1. DOI directly in the URL
		const inUrl = url.match(doiRe);
		if (inUrl) return inUrl[0];
		// 2. Nature: /articles/<id> maps to 10.1038/<id>
		const nat = url.match(/nature\.com\/articles\/([a-z0-9-]+)/i);
		if (nat && nat[1]) return `10.1038/${nat[1]}`;
		// 3. citation_doi meta tag on the page
		const meta = html.match(
			/<meta[^>]*name=["']citation_doi["'][^>]*content=["']([^"']*)["']/i,
		);
		if (meta && meta[1]) return meta[1].trim();
		// 4. Last resort: first DOI-looking string in the page
		const inHtml = html.match(doiRe);
		if (inHtml) return inHtml[0];
		return '';
	}

	// Ask Crossref for metadata by DOI
	async fetchCrossref(
		doi: string,
	): Promise<{ title: string; authors: string[]; abstract: string }> {
		try {
			const res = await requestUrl({
				url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
			});
			const msg = JSON.parse(res.text).message;
			const title = msg.title && msg.title[0] ? msg.title[0].trim() : '';
			const authors: string[] = (msg.author || [])
				.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim())
				.filter((s: string) => s.length > 0);
			// Crossref abstracts are JATS XML — strip tags if present
			const abstract = msg.abstract
				? msg.abstract.replace(/<[^>]+>/g, '').trim()
				: '';
			return { title, authors, abstract };
		} catch (e) {
			return { title: '', authors: [], abstract: '' };
		}
	}

	// If the input is a bare DOI or a doi.org link, return the DOI; else ''
	asDoiInput(input: string): string {
		const s = input.trim();
		const doiRe = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
		// doi.org link
		const link = s.match(/doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
		if (link && link[1]) return link[1];
		// bare DOI pasted on its own
		if (/^10\.\d{4,9}\//i.test(s)) {
			const m = s.match(doiRe);
			if (m) return m[0];
		}
		return '';
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