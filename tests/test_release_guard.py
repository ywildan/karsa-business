import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from release_guard import check_published, version_code

class ReleaseGuardTest(unittest.TestCase):
    def test_existing_version_code_compatible(self):
        self.assertEqual(version_code('v1.0.2'), 1000002)
        self.assertGreater(version_code('1.10.0'), version_code('1.9.999'))

    def test_invalid_and_colliding_versions_rejected(self):
        for value in ['1.1000.0', '1000.0.0', '1.0', '01.0.0', '1.0.2;id', '1.0.2\n']:
            with self.subTest(value=value), self.assertRaises(ValueError): version_code(value)

    def test_all_release_pages_and_prereleases_matter(self):
        releases = [{'tag_name':'v1.0.3', 'prerelease':True}, {'tag_name':'v1.0.1'}]
        with self.assertRaises(ValueError): check_published('1.0.2', releases)
        with self.assertRaises(ValueError): check_published('1.0.3', releases)
        check_published('1.0.4', releases)

if __name__ == '__main__': unittest.main()
