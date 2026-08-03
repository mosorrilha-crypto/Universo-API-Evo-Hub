import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export async function createOperator(db: any, tenantId: string, email: string, pass: string, name: string, role: string) {
  const hashedPassword = await bcrypt.hash(pass, 10);
  const operatorData = {
    tenantId,
    email,
    password: hashedPassword,
    name,
    role,
    createdAt: new Date().toISOString()
  };
  await db.collection('tenants').doc(tenantId).collection('operators').doc(email).set(operatorData);
  return { email, name, role, tenantId };
}

export async function authenticateOperator(db: any, tenantId: string, email: string, pass: string) {
  const docRef = db.collection('tenants').doc(tenantId || 'main-tenant').collection('operators').doc(email);
  const doc = await docRef.get();
  
  // For development demo convenience, if doc doesn't exist yet, seed a default admin
  if (!doc.exists && email === 'admin@seu-saas.com') {
    const admin = await createOperator(db, tenantId || 'main-tenant', email, pass, 'Admin Master', 'admin');
    const token = jwt.sign({ email: admin.email, role: admin.role, tenantId: admin.tenantId }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '24h' });
    return { token, operator: admin };
  }

  if (!doc.exists) {
    throw new Error('Usuário não encontrado');
  }

  const data = doc.data() as any;
  const match = await bcrypt.compare(pass, data.password);
  if (!match) {
    throw new Error('Senha incorreta');
  }

  const token = jwt.sign({ email: data.email, role: data.role, tenantId: data.tenantId }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '24h' });
  return { token, operator: { email: data.email, name: data.name, role: data.role, tenantId: data.tenantId } };
}
