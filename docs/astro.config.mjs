// The zigbee-codec-catalog docs: Starlight with the shared Pulzar theme
// (github.com/pulzar-net/docs-theme). Pages are in src/content/docs; the
// sidebar below orders them. CI builds it on every push (.github/workflows/docs.yml);
// the release workflow publishes it to Pages around the served releases (v/,
// versions.json), which keep their paths.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { pulzarPlugins } from '@pulzr/docs-theme';

export default defineConfig({
	site: 'https://pulzar-net.github.io',
	base: '/zigbee-codec-catalog',
	// Pages are page.html, as GitHub Pages serves them.
	build: { format: 'file' },
	integrations: [
		starlight({
			title: 'zigbee-codec-catalog',
			description: 'Every zigbee-herdsman-converters device definition as a self-contained codec any JavaScript engine runs.',
			plugins: pulzarPlugins({
				project: 'zigbee-codec-catalog',
				// The overview and format pages embed README.md and FORMAT.md, whose
				// links are relative to the repository (LICENSE, FORMAT.md). Pages
				// serves those files at the same paths, so the links hold there too.
				linkValidator: { errorOnRelativeLinks: false },
			}),
			sidebar: [
				{ label: 'Guide', items: ['overview', 'format'] },
				{ label: 'Releases', items: [
					{ label: 'Served releases (versions.json)', link: 'https://pulzar-net.github.io/zigbee-codec-catalog/versions.json' },
					{ label: 'Every release', link: 'https://github.com/pulzar-net/zigbee-codec-catalog/releases' },
				] },
			],
		}),
	],
});
