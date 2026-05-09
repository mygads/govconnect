/**
 * Optimize static assets for performance
 * - Generate proper favicon sizes
 * - Compress logo files
 * - Create optimized icons
 */

const fs = require('fs');
const path = require('path');

// Use sharp if available, otherwise use manual optimization
let sharp;
try {
  // Try pnpm path first
  sharp = require('../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp');
} catch (e) {
  try {
    sharp = require('sharp');
  } catch (e2) {
    console.log('Sharp not available, using manual optimization');
  }
}

const publicDir = path.join(__dirname, '..', 'public');

async function optimizeAssets() {
  console.log('🎨 Optimizing static assets...\n');

  if (!sharp) {
    console.log('⚠️  Sharp not installed. Please run: npm install sharp');
    console.log('📝 Manual optimization steps:');
    console.log('1. Compress favicon.ico to < 50KB (currently 219KB)');
    console.log('2. Generate icon-16x16.png (16x16)');
    console.log('3. Generate icon-32x32.png (32x32)');
    console.log('4. Generate apple-touch-icon.png (180x180)');
    console.log('5. Compress logo-dashboard.png to < 50KB (currently 136KB)');
    console.log('6. Compress logo-dashboard-dark.png to < 50KB (currently 298KB)');
    return;
  }

  try {
    const logoPath = path.join(publicDir, 'logo-dashboard.png');
    const logoDarkPath = path.join(publicDir, 'logo-dashboard-dark.png');

    // Generate 16x16 icon
    console.log('📦 Generating icon-16x16.png...');
    await sharp(logoPath)
      .resize(16, 16, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(path.join(publicDir, 'icon-16x16.png'));
    console.log('✅ icon-16x16.png created');

    // Generate 32x32 icon
    console.log('📦 Generating icon-32x32.png...');
    await sharp(logoPath)
      .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(path.join(publicDir, 'icon-32x32.png'));
    console.log('✅ icon-32x32.png created');

    // Generate 180x180 apple-touch-icon
    console.log('📦 Generating apple-touch-icon.png...');
    await sharp(logoPath)
      .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(path.join(publicDir, 'apple-touch-icon.png'));
    console.log('✅ apple-touch-icon.png created');

    // Generate proper favicon.ico (48x48 for better quality)
    console.log('📦 Generating favicon.ico...');
    await sharp(logoPath)
      .resize(48, 48, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(path.join(publicDir, 'favicon-temp.png'));

    // Rename temp to ico (browser will handle PNG in .ico extension)
    fs.renameSync(
      path.join(publicDir, 'favicon-temp.png'),
      path.join(publicDir, 'favicon.ico')
    );
    console.log('✅ favicon.ico created (48x48 PNG)');

    // Optimize logo-dashboard.png
    console.log('📦 Optimizing logo-dashboard.png...');
    const logoBuffer = await sharp(logoPath)
      .png({ quality: 85, compressionLevel: 9, effort: 10 })
      .toBuffer();
    fs.writeFileSync(path.join(publicDir, 'logo-dashboard-optimized.png'), logoBuffer);
    console.log(`✅ logo-dashboard-optimized.png created (${(logoBuffer.length / 1024).toFixed(1)}KB)`);

    // Optimize logo-dashboard-dark.png
    console.log('📦 Optimizing logo-dashboard-dark.png...');
    const logoDarkBuffer = await sharp(logoDarkPath)
      .png({ quality: 85, compressionLevel: 9, effort: 10 })
      .toBuffer();
    fs.writeFileSync(path.join(publicDir, 'logo-dashboard-dark-optimized.png'), logoDarkBuffer);
    console.log(`✅ logo-dashboard-dark-optimized.png created (${(logoDarkBuffer.length / 1024).toFixed(1)}KB)`);

    console.log('\n✨ Asset optimization complete!');
    console.log('\n📊 File sizes:');

    const files = [
      'favicon.ico',
      'icon-16x16.png',
      'icon-32x32.png',
      'apple-touch-icon.png',
      'logo-dashboard-optimized.png',
      'logo-dashboard-dark-optimized.png',
    ];

    files.forEach(file => {
      const filePath = path.join(publicDir, file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`  ${file}: ${(stats.size / 1024).toFixed(1)}KB`);
      }
    });

    console.log('\n📝 Next steps:');
    console.log('1. Replace logo-dashboard.png with logo-dashboard-optimized.png');
    console.log('2. Replace logo-dashboard-dark.png with logo-dashboard-dark-optimized.png');
    console.log('3. Update seo.ts to use new icon files');
    console.log('4. Update next.config.ts with cache headers');

  } catch (error) {
    console.error('❌ Error optimizing assets:', error.message);
    process.exit(1);
  }
}

optimizeAssets();
