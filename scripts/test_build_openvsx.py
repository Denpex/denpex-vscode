"""Unit tests for packages/denpex-vscode/scripts/build-openvsx.py."""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
import zipfile


SCRIPT_PATH = Path(__file__).resolve().parent / 'build-openvsx.py'
SPEC = importlib.util.spec_from_file_location('build_openvsx', SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
build_openvsx = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_openvsx)


def make_marketplace_keywords() -> list[str]:
    base = [f'gpu-keyword-{index}' for index in range(1, 30)]
    base.insert(12, 'xid-errors')
    assert len(base) == 30
    return base


def create_sample_vsix(directory: Path, keywords: list[str] | None = None, tags: list[str] | None = None) -> Path:
    source_keywords = keywords if keywords is not None else make_marketplace_keywords()
    source_tags = tags if tags is not None else list(source_keywords)
    vsix_path = directory / 'denpex-diagnostics-1.4.48-candidate.vsix'
    package_json = {
        'name': 'denpex-diagnostics',
        'version': '1.4.48',
        'homepage': 'https://denpex.com/vscode',
        'keywords': source_keywords,
    }
    manifest_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">\n'
        '  <Metadata>\n'
        f'    <Tags>{ ",".join(source_tags) }</Tags>\n'
        '    <Properties>\n'
        '      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="https://denpex.com/vscode" />\n'
        '    </Properties>\n'
        '  </Metadata>\n'
        '</PackageManifest>\n'
    )
    with zipfile.ZipFile(vsix_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('extension/package.json', json.dumps(package_json, indent=2) + '\n')
        archive.writestr('extension.vsixmanifest', manifest_xml)
        archive.writestr('extension/dist/extension.js', b'const ENGINE = "2026.10.19+offline-evidence-quality-r2";\n')
        archive.writestr('extension/out/canonical-offline.js', b'export const offlineEngineBytes = 0xdeadbeef;\n')
    return vsix_path


class BuildOpenVsxTest(unittest.TestCase):
    def test_replaces_xid_errors_with_kubernetes_in_30_keywords_and_preserves_engine_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = create_sample_vsix(Path(tmp))
            source_before = source.read_bytes()
            original_keywords = make_marketplace_keywords()

            target = build_openvsx.build(source)

            self.assertEqual(source.read_bytes(), source_before)
            self.assertTrue(target.exists())

            with zipfile.ZipFile(source) as src_zip, zipfile.ZipFile(target) as dst_zip:
                self.assertEqual(set(src_zip.namelist()), set(dst_zip.namelist()))
                for name in src_zip.namelist():
                    if name not in {'extension/package.json', 'extension.vsixmanifest'}:
                        self.assertEqual(dst_zip.read(name), src_zip.read(name))

                src_pkg = json.loads(src_zip.read('extension/package.json'))
                self.assertEqual(src_pkg['keywords'], original_keywords)
                self.assertEqual(len(src_pkg['keywords']), 30)

                dst_pkg = json.loads(dst_zip.read('extension/package.json'))
                self.assertEqual(dst_pkg['homepage'], 'https://denpex.com/openvsx')
                dst_keywords = dst_pkg['keywords']
                self.assertEqual(len(dst_keywords), 30)
                self.assertIn('kubernetes', dst_keywords)
                self.assertNotIn('xid-errors', dst_keywords)
                self.assertEqual(
                    dst_keywords,
                    ['kubernetes' if item == 'xid-errors' else item for item in original_keywords],
                )

                manifest = dst_zip.read('extension.vsixmanifest').decode('utf-8')
                self.assertIn('https://denpex.com/openvsx', manifest)
                match = re.search(r'<Tags>(.*?)</Tags>', manifest, re.S)
                self.assertIsNotNone(match)
                assert match is not None
                dst_tags = match.group(1).split(',')
                self.assertEqual(len(dst_tags), 30)
                self.assertEqual(dst_tags, dst_keywords)

    def test_preserves_generated_keybindings_manifest_tag_while_requiring_30_declared_keywords(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            original_keywords = make_marketplace_keywords()
            manifest_tags = [*original_keywords, 'keybindings']
            source = create_sample_vsix(Path(tmp), keywords=original_keywords, tags=manifest_tags)

            target = build_openvsx.build(source)

            with zipfile.ZipFile(target) as dst_zip:
                dst_pkg = json.loads(dst_zip.read('extension/package.json'))
                dst_keywords = dst_pkg['keywords']
                self.assertEqual(len(dst_keywords), 30)
                self.assertIn('kubernetes', dst_keywords)
                self.assertNotIn('xid-errors', dst_keywords)
                self.assertNotIn('keybindings', dst_keywords)

                manifest = dst_zip.read('extension.vsixmanifest').decode('utf-8')
                match = re.search(r'<Tags>(.*?)</Tags>', manifest, re.S)
                self.assertIsNotNone(match)
                assert match is not None
                dst_tags = match.group(1).split(',')
                self.assertEqual(len(dst_tags), 31)
                self.assertEqual(dst_tags, [*dst_keywords, 'keybindings'])

    def test_rejects_package_without_xid_errors_or_with_existing_kubernetes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            without_xid = [f'kw-{index}' for index in range(30)]
            bad_source = create_sample_vsix(Path(tmp), keywords=without_xid, tags=without_xid)
            with self.assertRaises(ValueError):
                build_openvsx.build(bad_source)

        with tempfile.TemporaryDirectory() as tmp:
            already_k8s = make_marketplace_keywords()
            already_k8s[0] = 'kubernetes'
            bad_source = create_sample_vsix(Path(tmp), keywords=already_k8s, tags=already_k8s)
            with self.assertRaises(ValueError):
                build_openvsx.build(bad_source)


if __name__ == '__main__':
    unittest.main()
