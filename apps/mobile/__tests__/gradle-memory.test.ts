// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyCaps, CAPS } = require('../plugins/with-gradle-memory.js') as {
  applyCaps: (props: Array<{ type: string; key?: string; value?: string }>) => unknown[];
  CAPS: Record<string, string>;
};

describe('with-gradle-memory plugin', () => {
  it('adds the caps to a generated gradle.properties', () => {
    const props = [{ type: 'property', key: 'android.useAndroidX', value: 'true' }];
    applyCaps(props);
    expect(props).toContainEqual({
      type: 'property',
      key: 'kotlin.daemon.jvmargs',
      value: '-Xmx1g',
    });
    expect(props).toContainEqual({
      type: 'property',
      key: 'org.gradle.jvmargs',
      value: '-Xmx2048m -XX:MaxMetaspaceSize=512m',
    });
    expect(props).toHaveLength(3);
  });

  it('replaces a value the template set (no duplicates), and is idempotent', () => {
    const props = [
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m' },
      { type: 'comment', value: '# memory' },
    ];
    applyCaps(props);
    applyCaps(props);
    const gradle = props.filter((p) => p.key === 'org.gradle.jvmargs');
    expect(gradle).toEqual([
      { type: 'property', key: 'org.gradle.jvmargs', value: CAPS['org.gradle.jvmargs'] },
    ]);
    expect(props.filter((p) => p.key === 'kotlin.daemon.jvmargs')).toHaveLength(1);
  });
});
