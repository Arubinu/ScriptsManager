const	fs = require('fs'),
		path = require('path'),
		inifile = { read: require('read-ini-file'), write: require('write-ini-file') },
		{ app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');

const	icon = nativeImage.createFromPath(path.join(__dirname, 'public', 'images', 'logo.png'));

let		win,
		tray,
		menus = {},
		addons = {},
		scripts = {},
		app_exit = false;

function create_window()
{
	win = new BrowserWindow({
		show: false,
		icon: icon,
		width: 1140,
		height: 630,
		autoHideMenuBar: true,
		webPreferences: {
			//devTools: true,
			//nodeIntegration: true,
			//contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	});
	win.setTitle('Scripts Manager');
	win.loadFile(path.join(__dirname, 'public', 'index.html')).then(() => {
		ipcMain.handle('manager', (event, data) => {
			console.log('manager:', data);
			if (data.type == 'general')
			{
				console.log('main manager receive:', data);
			}
			else if (data.type == 'addons' && typeof(addons[data.id]) === 'object' && typeof(addons[data.id].include.receiver) === 'function')
				addons[data.id].include.receiver('manager', data.name, data.data);
			else if (data.type == 'scripts' && typeof(scripts[data.id]) === 'object' && typeof(scripts[data.id].include.receiver) === 'function')
				scripts[data.id].include.receiver('manager', data.name, data.data);
		});
		ipcMain.handle('message', (event, data) => {
			if (data.type == 'general')
			{
				console.log('main message receive:', data);
			}
			else if (data.type == 'addons' && typeof(addons[data.id]) === 'object' && typeof(addons[data.id].include.receiver) === 'function')
				addons[data.id].include.receiver('message', data.name, data.data);
			else if (data.type == 'scripts' && typeof(scripts[data.id]) === 'object' && typeof(scripts[data.id].include.receiver) === 'function')
				scripts[data.id].include.receiver('message', data.name, data.data);
		});

		let addons_config = {};
		for (const id in addons)
			addons_config[id] = addons[id].config;

		let scripts_config = {};
		for (const id in scripts)
			scripts_config[id] = scripts[id].config;

		win.webContents.send('init', {
			menus: menus,
			configs: {
				addons: addons_config,
				scripts: scripts_config
			}
		});
	});

	win.on('close', event => {
		event.preventDefault();
		win.hide();
	});
}

async function save_config(type, id, data)
{
	let obj = null;
	if (type == 'addons')
		obj = addons[id].config;
	else if (type == 'scripts')
		obj = scripts[id].config;
	else
		return false;

	for (const section in data)
	{
		if (['default', 'menu'].indexOf(section) < 0 && typeof(data[section]) === 'object')
		{
			if (typeof(obj[section]) !== 'object')
				obj[section] = {};
		}
	}

	return await inifile.write(path.join(__dirname, type, id, 'config.ini'), obj);
}

function load_addons()
{
	return new Promise((resolve, reject) => {
		let dir = path.join(__dirname, 'addons');
		fs.readdir(dir, (err, files) => {
			if (err)
				return reject(err);

			files.forEach(file => {
				let addon_path = path.join(dir, file);
				let addon_file = path.join(addon_path, 'addon.js');
				let config_file = path.join(addon_path, 'config.ini');
				if (fs.existsSync(addon_file) && fs.existsSync(config_file) && fs.existsSync(path.join(addon_path, 'index.html')))
				{
					try
					{
						let config = JSON.parse(JSON.stringify(inifile.read.sync(config_file)));
						if (typeof(config.default.name) === 'string')
						{
							addons[file] = {
								config: config,
								include: require(addon_file)
							}

							if (typeof(addons[file].include.init) === 'function')
								addons[file].include.init(addon_path, addons[file].config, async function() { return await script_sender('addons', file, null, ...arguments); });

							console.log('Addon loaded:', file);
						}
					}
					catch (e)
					{
						delete addons[file];
						console.log('Addon error:', file, e);
					}
				}
			});

			resolve(scripts);
		});
	});
}

function load_scripts()
{
	return new Promise((resolve, reject) => {
		let dir = path.join(__dirname, 'scripts');
		fs.readdir(dir, (err, files) => {
			if (err)
				return reject(err);

			files.forEach(file => {
				let script_path = path.join(dir, file);
				let script_file = path.join(script_path, 'script.js');
				let config_file = path.join(script_path, 'config.ini');
				if (fs.existsSync(script_file) && fs.existsSync(config_file) && fs.existsSync(path.join(script_path, 'index.html')))
				{
					try
					{
						let config = JSON.parse(JSON.stringify(inifile.read.sync(config_file)));
						if (typeof(config.default.name) === 'string' && typeof(config.default.version) === 'string' && typeof(config.default.author) === 'string')
						{
							menus[file] = [];
							if (typeof(config.menu) === 'object')
							{
								for (let id in config.menu)
								{
									if (id.indexOf('/') < 0 && id.indexOf('\\') < 0 && fs.existsSync(path.join(script_path, `${id}.html`)))
										menus[file].push({ id: id, name: config.menu[id] });
								}
							}

							scripts[file] = {
								menu: [],
								config: config,
								include: require(script_file)
							}

							if (typeof(scripts[file].include.init) === 'function')
								scripts[file].include.init(script_path, scripts[file].config, async function() { return await script_sender('scripts', file, ...arguments); });

							console.log('Script loaded:', file);
						}
					}
					catch (e)
					{
						delete scripts[file];
						console.log('Script error:', file, e);
					}
				}
			});

			resolve(scripts);
		});
	});
}

async function script_sender(type, id, target, name, data)
{
	if (type == 'addons')
	{
		if (target == 'manager')
		{
			if (name == 'config')
				save_config(type, id, data);
		}
		else if (target == 'message')
			win.webContents.send('message', { type, id, name, data });
		else if (typeof(addons[id].include.receiver) === 'function')
		{
			for (const sid in scripts)
			{
				if (typeof(scripts[sid].config.default.addons) === 'string' && scripts[sid].config.default.addons.split(',').indexOf(id) >= 0)
					scripts[sid].include.receiver(id, name, data);
			}
		}
	}
	else if (type == 'scripts')
	{
		if (target == 'manager')
		{
			if (name == 'menu')
			{
				scripts[id].menu = data;
				generate_menu();
			}
			else if (name == 'config')
				save_config(type, id, data);
			else
				return 'feature not found'; // retourner une exception

			return true;
		}
		else if (target == 'message')
		{
			win.webContents.send('message', { type, id, name, data });
			return true;
		}
		else if (typeof(addons[target]) !== 'object')
			return 'addon not found'; // retourner une exception
		else if (typeof(scripts[id].include.receiver) !== 'function')
			return 'addon receiver not found'; // retourner une exception

		return await addons[target].include.receiver(id, name, data);
	}
}

function generate_menu()
{
	let scripts_menu = [];
	for (let name in scripts)
	{
		try
		{
			const menu = scripts[name].menu;
			if (menu.length)
			{
				let tmp = { label: scripts[name].config.default.name };
					tmp.submenu = menu;

				Menu.buildFromTemplate([tmp]);
				scripts_menu.push(tmp);
			}
		}
		catch (e) {}
	}

	tray.setContextMenu(Menu.buildFromTemplate(scripts_menu.concat([
		{ type: 'separator' },
		{ label: 'Settings', click : async () => {
			win.show();
		} },
		{ label: 'Quit', click : async () => {
			app.exit();
		} }
	])));
}

app.whenReady().then(() => {
	tray = new Tray(icon);
	tray.setToolTip('ScriptManager');

	tray.on('double-click', () => {
		win.show();
	});

	const next = () => {
		const next = () => {
			generate_menu();
			create_window();

			app.on('activate', () => {
				//if (BrowserWindow.getAllWindows().length === 0)
				if (!win)
					create_window();
				else if (!win.isVisible())
					win.show();
			});
		};

		load_scripts().then(next).catch(next);
	};

	load_addons().then(next).catch(next);
});
