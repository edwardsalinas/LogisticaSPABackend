import fs from 'fs';

const filePath = 'c:/Users/estiven.salinas/Desktop/maestria/especialidad/backend/src/modules/fleet/fleet.service.js';
let content = fs.readFileSync(filePath, 'utf8');

const target = `.map(u => ({
      id: u.id,
      email: u.email,
      name: u.user_metadata?.first_name 
            ? \`\${u.user_metadata.first_name} \${u.user_metadata.last_name || ''}\`.trim()
            : 'Sin Nombre',
      phone: u.user_metadata?.phone || null
    }));`;

// Note: I will use a regex to be safer about whitespaces
const regex = /\.map\(u => \(\{[\s\S]*?name: u\.user_metadata\?\.first_name[\s\S]*?\}\)\);/g;

const replacement = `.map(u => ({
      id: u.id,
      email: u.email,
      name: u.user_metadata?.full_name || 
            (u.user_metadata?.first_name 
              ? \`\${u.user_metadata.first_name} \${u.user_metadata.last_name || ''}\`.trim()
              : u.email),
      phone: u.user_metadata?.phone || null
    }));`;

content = content.replace(regex, replacement);
fs.writeFileSync(filePath, content);
console.log('File patched successfully');
