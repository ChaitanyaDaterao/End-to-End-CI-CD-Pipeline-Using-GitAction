describe('Basic sanity tests', () => {
  test('environment is set up correctly', () => {
    expect(1 + 1).toBe(2);
  });

  test('bcrypt is available for password hashing', () => {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('testpassword', 10);
    expect(bcrypt.compareSync('testpassword', hash)).toBe(true);
  });

  test('jwt can sign and verify tokens', () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 'user123' }, 'test-secret', { expiresIn: '1h' });
    const decoded = jwt.verify(token, 'test-secret');
    expect(decoded.id).toBe('user123');
  });
});
