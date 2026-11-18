"""Create an Open VSX variant of a built VSIX without changing Marketplace metadata.

Usage: python scripts/build-openvsx.py denpex-diagnostics-1.4.48-candidate.vsix
This only packages locally. It never publishes or uses registry credentials.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def build(source: Path) -> Path:
    target = source.with_name(source.stem + '-openvsx.vsix')
    with zipfile.ZipFile(source) as archive:
        package = json.loads(archive.read('extension/package.json'))
        if package.get('homepage') != 'https://denpex.com/vscode':
            raise ValueError('Expected source package homepage to be https://denpex.com/vscode')
        keywords = package.get('keywords', [])
        if len(keywords) != 30 or 'xid-errors' not in keywords or 'kubernetes' in keywords:
            raise ValueError('Expected the unchanged 30-keyword Marketplace package')
        expected_keywords = [*keywords, 'kubernetes']
        package['keywords'] = expected_keywords
        package['homepage'] = 'https://denpex.com/openvsx'
        manifest = archive.read('extension.vsixmanifest').decode('utf-8')
        
        src_root = ET.fromstring(manifest)
        src_homepage_props = [
            elem for elem in src_root.iter()
            if elem.tag.endswith('Property') and elem.attrib.get('Id') == 'Microsoft.VisualStudio.Services.Links.Learn'
        ]
        if len(src_homepage_props) != 1 or src_homepage_props[0].attrib.get('Value') != 'https://denpex.com/vscode':
            raise ValueError('Expected exactly one source Homepage property with exact value https://denpex.com/vscode')

        matches = list(re.finditer(r'<Tags>(.*?)</Tags>', manifest, re.S))
        if len(matches) != 1:
            raise ValueError('Expected exactly one VSIX Tags element')
        tags = matches[0].group(1).split(',')
        if len(tags) < len(keywords) or not all(keyword in tags for keyword in keywords) or tags.count('xid-errors') != 1 or 'kubernetes' in tags:
            raise ValueError('VSIX tags do not match the source keywords')
        expected_tags = [*tags, 'kubernetes']
        manifest = manifest[:matches[0].start(1)] + ','.join(expected_tags) + manifest[matches[0].end(1):]
        
        homepage_pattern = r'(<Property\s+Id="Microsoft\.VisualStudio\.Services\.Links\.Learn"\s+Value=")[^"]*("\s*/>)'
        if not re.search(homepage_pattern, manifest):
            raise ValueError('Expected Microsoft.VisualStudio.Services.Links.Learn property in vsixmanifest')
        manifest = re.sub(homepage_pattern, r'\1https://denpex.com/openvsx\2', manifest)
        
        root = ET.fromstring(manifest)
        homepage_props = [
            elem for elem in root.iter()
            if elem.tag.endswith('Property') and elem.attrib.get('Id') == 'Microsoft.VisualStudio.Services.Links.Learn'
        ]
        if len(homepage_props) != 1 or homepage_props[0].attrib.get('Value') != 'https://denpex.com/openvsx':
            raise ValueError('Expected exactly one target Homepage property with exact value https://denpex.com/openvsx')

        replacements = {
            'extension/package.json': (json.dumps(package, indent=2, ensure_ascii=False) + '\n').encode('utf-8'),
            'extension.vsixmanifest': manifest.encode('utf-8'),
        }
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as output:
            for entry in archive.infolist():
                output.writestr(copy.copy(entry), replacements.get(entry.filename, archive.read(entry.filename)))
        with zipfile.ZipFile(target) as output:
            if output.testzip() is not None:
                raise ValueError('Archive integrity check failed')
            if set(output.namelist()) != set(archive.namelist()):
                raise ValueError('Archive file list changed')
            for name in archive.namelist():
                if name not in replacements and output.read(name) != archive.read(name):
                    raise ValueError('Unexpected content change: ' + name)
            actual_pkg = json.loads(output.read('extension/package.json'))
            actual = actual_pkg['keywords']
            if actual != expected_keywords or len(actual) != 31 or 'kubernetes' not in actual or 'xid-errors' not in actual:
                raise ValueError('Keyword verification failed')
            if actual_pkg.get('homepage') != 'https://denpex.com/openvsx':
                raise ValueError('Package homepage verification failed')
            output_manifest = output.read('extension.vsixmanifest').decode('utf-8')
            
            out_root = ET.fromstring(output_manifest)
            out_homepage_props = [
                elem for elem in out_root.iter()
                if elem.tag.endswith('Property') and elem.attrib.get('Id') == 'Microsoft.VisualStudio.Services.Links.Learn'
            ]
            if len(out_homepage_props) != 1 or out_homepage_props[0].attrib.get('Value') != 'https://denpex.com/openvsx':
                raise ValueError('Output manifest Homepage property verification failed')

            output_matches = list(re.finditer(r'<Tags>(.*?)</Tags>', output_manifest, re.S))
            if len(output_matches) != 1:
                raise ValueError('Expected exactly one output VSIX Tags element')
            actual_tags = output_matches[0].group(1).split(',')
            if actual_tags != expected_tags or len(actual_tags) != len(tags) + 1 or not all(keyword in actual_tags for keyword in expected_keywords) or 'kubernetes' not in actual_tags or 'xid-errors' not in actual_tags:
                raise ValueError('Manifest tag verification failed')
    print(json.dumps({'file': str(target), 'keywords': len(actual), 'preservedKeywords': len(keywords),
                      'tags': len(actual_tags), 'added': 'kubernetes',
                      'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'published': False}, indent=2))
    return target


if __name__ == '__main__':
    build(Path(sys.argv[1]).resolve())
