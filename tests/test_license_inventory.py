import zipfile
from scripts.license_inventory import inventory


def test_inventory_checks_nested_license_paths(tmp_path):
    archive = tmp_path / 'runtime.zip'
    with zipfile.ZipFile(archive, 'w') as target:
        target.writestr('Lib/pkg.dist-info/METADATA', 'Name: pkg\nVersion: 1\nLicense-Expression: MIT\nLicense-File: nested/include/LICENSE.txt\n')
        target.writestr('Lib/pkg.dist-info/licenses/nested/include/LICENSE.txt', 'license')
    result = inventory(archive)
    assert result['packages'][0]['license_files'][0]['path'].endswith('include/LICENSE.txt')
    assert result['legal_approval'] is False


def test_inventory_reports_missing_notice(tmp_path):
    archive = tmp_path / 'runtime.zip'
    with zipfile.ZipFile(archive, 'w') as target:
        target.writestr('Lib/pkg.dist-info/METADATA', 'Name: pkg\nVersion: 1\nLicense-File: LICENSE\n')
    assert inventory(archive)['packages'][0]['license_files'][0]['path'] is None
