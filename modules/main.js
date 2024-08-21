const { status: statusTypes, checkDomain, getChar } = require("./status");
const { writeFileSync } = require("fs");
const { join } = require("path");
const { Message } = require("discord.js");

// display logo
require("./logo");

const Discord = require("./discord");
let client = new Discord();

let config = require("../data/config.json");
let data = require("../data/data.json");
let { repository, version, author } = require("../package.json");

// wait for every guild to complete the action
let pendingGuilds = new Map();

// setup command
client.commands.on("setup", async (msg, args = []) => {
  // check permissions
  if (!msg.member.permissions.has("MANAGE_CHANNELS"))
    return msg
      .reply("Bu komutu çalıştırma izniniz yok!")
      .catch(() => { });

  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("Aborted!").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  // check if guild has pending action
  if (pendingGuilds.get(msg.guild.id) === true){
    return msg
      .reply("Bekleyen eylemleriniz var!")
      .catch(() => { });
  } else pendingGuilds.set(msg.guild.id, true);
  
  msg.reply("⚠️ Lütfen bekleyin...").then(async (res) => {
    // check if the guild is already setup
    if (data.categorys[msg.guild.id] !== undefined) {
      // verify the action
      if (args[0]?.toUpperCase() === "CONFIRM") {
        // try to get the guilds category
        let category = await msg.guild.channels
          .fetch(data.categorys[msg.guild.id])
          .catch(() => { });

        // if the category still exists, delete it
        if (category !== undefined) await category.delete().catch(() => { });

        // remove domain channels associated with the guild
        data.domains
          .filter((f) => f.guild === msg.guild.id)
          .forEach(async (domain) => {
            // try to get the channel
            let channel = await msg.guild.channels
              .fetch(domain.channel)
              .catch(() => { });

            // if the channel still exists, delete it
            if (channel !== undefined) await channel.delete().catch(() => { });
          });
      } else {
        // warn the user
        return await res
          .edit(
            "🛑 Bu komutu kullanmak tüm kayıtlı alan adlarınızı kaldıracaktır!\nNe yaptığınızı biliyorsanız, yine de devam etmek için ``!setup confirm`` komutunu kullanın."
          )
          .catch(() => { });
      }
    }

    // remove all domains that are still registered to this guild
    data.domains = data.domains.filter((d) => d.guild !== msg.guild.id);

    // create category and move to top
    let category = await msg.guild.channels
      .create("Aktiflik Durumu", {
        type: "GUILD_CATEGORY",
      })
      .catch(() => { });
    await category.setPosition(0).catch(() => { });

    // push to database
    data.categorys[msg.guild.id] = category.id;

    res
      .edit(
        "✅ Bu bot için alan adı durumunu başarıyla ayarlayın!\nArtık kullanarak alan ekleyebilirsiniz ``" + config.discord.prefix + "domain add <domain> [display_name]``"
      )
      .catch(() => { });
    console.log(`${msg.guild.name} (${msg.guild.id}) kuruldu!`);
  }).finally(() => pendingGuilds.set(msg.guild.id, false));
});

// add/remove domain command
client.commands.on("domain", async (msg, args = []) => {
  // check permissions
  if (!msg.member.permissions.has("MANAGE_CHANNELS"))
    return msg
      .reply("Bu komutu çalıştırma izniniz yok!")
      .catch(() => { });

  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("Iptal!").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  // is a action and a domain is provided?
  if (args.length < 1)
    return msg
      .reply("🛑 Lütfen hangi eylemi gerçekleştirmek istediğinizi belirtin.")
      .catch(() => { });
  if (args.length < 2)
    return msg.reply("🛑 Bir alan adı sağlamanız gerekiyor!").catch(() => { });

  let action = args[0]?.toUpperCase();
  let domain = args[1];

  let display = undefined;
  if (args.length >= 3) display = args.splice(2).join(" ");

  // check if guild has pending action
  if (pendingGuilds.get(msg.guild.id) === true){
    return msg
      .reply("Bekleyen eylemleriniz var!")
      .catch(() => { });
  } else pendingGuilds.set(msg.guild.id, true);
  
  msg.reply(`⚠️ Please wait...`).then(async (res) => {
    // check if the guild is already setup
    if (data.categorys[msg.guild.id] === undefined)
      return await res.edit("🛑 Bu bot henüz kurulmadı!").catch(() => { });

    if (action === "ADD") {
      // check if the domain is already registered
      let i = data.domains.findIndex(
        (d) => d.name === domain && d.guild === msg.guild.id
      );
      if (i !== -1)
        return await res
          .edit("🛑 Bu alan adı zaten kayıtlı!")
          .catch(() => { });

      // check current domain status
      let status = await checkDomain(domain).catch(() => { });
      if (status === undefined)
        return console.log(
          `[Error]`.padEnd(8),
          `Alan adı ${domain} durumunu kontrol etmeye çalışırken beklenmeyen hata!`
        );

      // get category
      let category = await msg.guild.channels
        .fetch(data.categorys[msg.guild.id])
        .catch(() => { });
      if (category === undefined) {
        res.edit(
          `🛑 Bir şeyler korkunç bir şekilde ters gitti! Lütfen kurulum komutunu tekrar çalıştırmayı deneyin ve yine de başarısız olursanız Yetkililere bildirin!`
        );
        console.log(
          `[Error]`.padEnd(8),
          `Kategoriyi almaya çalışırken beklenmeyen hata ${domain}!`
        );
        return;
      }

      // create new channel
      let channel = await msg.guild.channels
        .create(
          `${getChar(status, config.indicators)} ${display != null ? display : domain
          }`,
          {
            type: "GUILD_VOICE",
            permissionOverwrites: [
              {
                id: msg.guild.roles.everyone.id,
                deny: ["CONNECT"],
                allow: ["VIEW_CHANNEL"],
              },
            ],
          }
        )
        .catch(() => { });
      if (channel === undefined) {
        res.edit(
          `🛑 Bir şeyler korkunç bir şekilde ters gitti! Lütfen botun bu kategoride kanal oluşturma iznine sahip olduğundan emin olun!`
        );
        console.log(
          `[Error]`.padEnd(8),
          `Şunun için bir kanal oluşturmaya çalışırken beklenmeyen hata oluştu ${domain}!`
        );
        return;
      }

      channel.setParent(category);

      // add to database
      data.domains.push({
        channel: channel.id,
        name: domain,
        guild: msg.guild.id,
        lastStatus: status,
        display: display,
      });

      res
        .edit(`✅ Aktiflik veritabanına başarıyla eklendi!`)
        .catch(() => { });
      console.log(`${domain} veritabanına eklendi!`);
    } else if (action === "REMOVE") {
      // check if the domain is registered
      let i = data.domains.findIndex(
        (d) => d.name === domain && d.guild === msg.guild.id
      );
      if (i === -1)
        return await res
          .edit("🛑 Bu alan adı kayıtlı değil!")
          .catch(() => { });

      // delete channel
      let channel = await msg.guild.channels
        .fetch(data.domains[i].channel)
        .catch(() => { });
      if (channel !== undefined) await channel.delete().catch(() => { });

      // remove from database
      data.domains.splice(i, 1);

      res
        .edit(`✅ Aktiflik veritabanından başarıyla kaldırıldı!`)
        .catch(() => { });
      console.log(`${domain} veritabanından kaldırıldı!`);
    }
  }).finally(() => pendingGuilds.set(msg.guild.id, false));

});

// register about command
client.commands.on("about", async (msg, args = []) => {
  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("İptal!").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  let embed = client
    .createEmbed(
      "Zenora Uptimer",
      `Botlarınızı kesintisiz 7/24 çalıştıran ve bağlantı sorunlarını otomatik olarak çözen bir araçtır.\n` +
      `\n` +
      //`GitHub: ${repository.url.substring(4)}\n` +
      `Add me: https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=8`
    )
    .addField("Version", version, true)
    .addField("Author", author.name, true);

  msg.reply({ embeds: [embed] }).catch(() => { });
});

// help command
client.commands.on("help", async (msg, args = []) => {
  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("Aborted!").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  msg
    .reply(
      `Bu, bu botla kullanabileceğiniz tüm komutların bir listesidir.\n` +
      `\n` +
      `**${config.discord.prefix}about**\n` +
      `Bu bot hakkındaki bilgileri gösterir.\n` +
      `\n` +
      `**${config.discord.prefix}check <domain>**\n` +
      `Verilen botun durumunu kontrol eder.\n` +
      `\n` +
      `**${config.discord.prefix}domain <add/remove> <domain> [display_name]**\n` +
      `Site ekler ekler veya kaldırır.\n` +
      `\n` +
      `**${config.discord.prefix}help**\n` +
      `Bu yardım mesajını gösterir.\n` +
      `\n` +
      `**${config.discord.prefix}indicators**\n` +
      `Göstergelerin anlamını gösterir.\n` +
      `**${config.discord.prefix}rename <domain> [display_text]**\nVerilen botun görüntü metnini değiştirir.\n` +
      `\n` +
      `**${config.discord.prefix}setup**\n` +
      `Botu ilk kez ayarlar.\n`
    )
    .catch(() => { });
});

// indicators command
client.commands.on("indicators", async (msg, args = []) => {
  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("İptal!").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  msg
    .reply(
      `Burada göstergelerin anlamını görebilirsiniz.\n` +
      `\n` +
      `${config.indicators.reachable} Site alındı ve yayınlanıyor.\n` +
      `${config.indicators.websiteError} Site üzerinde hak talep edildi ve içerik sunuldu, ancak web sitesi bir hata döndürdü.\n` +
      `${config.indicators.unreachable} Site üzerinde hak talebinde bulunulmuştur ve içerik sunmaz.\n` +
      `${config.indicators.unclaimed} Site üzerinde hak iddia edilmedi.`
    )
    .catch(() => { });
});

// check domain command
client.commands.on("check", async (msg, args = []) => {
  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("Aborted!").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  if (args.length < 1)
    return msg.reply("🛑 Bir site yazmanız gerekiyor!").catch(() => { });

  let domain = args[0];

  // check if guild has pending action
  if (pendingGuilds.get(msg.guild.id) === true){
    return msg
      .reply("Bekleyen eylemleriniz var!")
      .catch(() => { });
  } else pendingGuilds.set(msg.guild.id, true);
  
  msg.reply(`⚠️ Lütfen bekleyin...`).then(async (res) => {
    // check current domain status
    let status = await checkDomain(domain).catch(() => { });
    if (status === undefined)
      return console.log(
        `[Error]`.padEnd(8),
        `Site kontrol etmeye çalışırken beklenmeyen hata ${domain.name} status!`
      );

    let statusHuman = "";
    switch (status) {
      case statusTypes.REACHABLE:
        statusHuman = "Site alındı ve yayınlanıyor.";
        break;

      case statusTypes.WEBSITE_ERROR:
        statusHuman =
          "Site üzerinde hak talep edildi ve içerik sunuldu, ancak web sitesi bir hata döndürdü.";
        break;

      case statusTypes.UNREACHABLE:
        statusHuman = "Site üzerinde hak talebinde bulunulmuştur ve içerik sunmaz.";
        break;

      case statusTypes.UNCLAIMED:
        statusHuman = "Site üzerinde hak iddia edilmedi.";
        break;
    }

    // send embed
    res
      .edit(
        `${getChar(status, config.indicators)} **${domain}**\n${statusHuman}`
      )
      .catch(() => { });
    console.log(
      `${domain} alan adı için ${msg.author.username} tarafından talep edilen önceden oluşturulmuş manuel kontrol.`
    );
  }).finally(() => pendingGuilds.set(msg.guild.id, false));
});

// rename domain command
client.commands.on("rename", async (msg, args = []) => {
  // check permissions
  if (!msg.member.permissions.has("MANAGE_CHANNELS"))
    return msg
      .reply("Bu komutu çalıştırma izniniz yok!")
      .catch(() => { });

  // check own permissions
  let me = await msg.guild.members.fetch(client.user.id).catch(() => { });
  if (me === undefined) return msg.reply("İptal").catch(() => { });
  if (!me.permissions.has("ADMINISTRATOR"))
    return msg
      .reply(
        "İzin ayarlarınızla ilgili bir sorun var. Lütfen beni sunucunuzdan kaldırın ve tekrar ekleyin."
      )
      .catch(() => { });

  // is a display_name and a domain is provided?
  if (args.length < 1)
    return msg.reply("🛑 Bir site yazmanız gerekiyor!").catch(() => { });

    // check if guild has pending action
    if (pendingGuilds.get(msg.guild.id) === true){
      return msg
        .reply("Bekleyen eylemleriniz var!")
        .catch(() => { });
    } else pendingGuilds.set(msg.guild.id, true);
    
  msg
    .reply(`⚠️ Lütfen bekleyin...`)
    .then(async (res) => {
      let domain = args[0];
      let display = "";

      if (args.length > 1) display = args.splice(1).join(" ");

      // get domain index
      let i = data.domains.findIndex(
        (d) => d.name === domain && d.guild === msg.guild.id
      );
      if (i == -1)
        return res
          .edit("🛑 Bu site henüz veritabanına eklenmedi!")
          .catch(() => { });

      // update domain in database
      data.domains[i].display = display;

      // rename channel
      let channel = msg.guild.channels.cache.find(
        (c) => c.id === data.domains[i].channel
      );
      if (channel == undefined)
        return res
          .edit("🛑 Kanal kimliği geçersiz! Lütfen bu kategorini kaldırın.")
          .catch(() => { });

      await channel.setName(
        `${getChar(data.domains[i].lastStatus, config.indicators)} ${display != "" ? display : domain}`
      ).catch(() => { });

      await res
        .edit(`✅ Bot başarıyla yeniden adlandırıldı!`)
        .catch(() => { });
    }).catch(() => { }).finally(() => pendingGuilds.set(msg.guild.id, false));

});

// automated checks and updates
function updateDomains() {
  // check all domains
  data.domains.forEach(async (domain) => {
    let status = await checkDomain(domain.name).catch(() => { });
    if (status === undefined)
      return console.log(
        `[Error]`.padEnd(8),
        `Site ${domain.name} durumunu kontrol etmeye çalışırken beklenmeyen hata!`
      );

    //console.log(domain.display);

    // update status
    if (status !== domain.lastStatus) {
      if (domain.guild === "0") return;

      let channel = await (
        await client.guilds.fetch(domain.guild).catch(() => { })
      )?.channels
        ?.fetch(domain.channel)
        .catch(() => { });

      // if the channel doesn't exist anymore, delete the domain
      if (channel === undefined)
        return data.domains.splice(
          data.domains.findIndex((d) => d.name === domain.name),
          1
        );

      let name = domain.name;
      if (domain.display == undefined || domain.display == null) domain.display = "";
      if (domain.display != "") name = domain.display;

      await channel
        .setName(`${getChar(status, config.indicators)} ${name}`)
        .catch(() =>
          console.log(
            `[Warning]`.padEnd(8),
            `${domain.name} site için kanalın adı ${channel.guild.name} olarak güncellenemedi!`
          )
        );
      domain.lastStatus = status;
    }
  });
}

// verify if the registered domains and servers are still valid
async function verifyData() {
  // check if all categories are still valid
  for (let key in data.categorys) {
    if (key === "0") continue;

    // check if still connected to the server
    let guild = await client.guilds.fetch(key).catch(() => { });
    if (guild === undefined) {
      // remove category
      data.categorys[key] = undefined;

      // also remove all associated domains
      data.domains = data.domains.filter((d) => d.guild !== key);

      console.log(
        `[Info]`.padEnd(8),
        `Artık bir sunucuya bağlı olmadığı için ${key} kategorisi kaldırıldı.`
      );
      continue;
    }

    // check if all associated domains are still valid
    data.domains.forEach(async (domain, i) => {
      if (domain.guild !== key) return;

      // check if the channel still exists
      let channel = await guild.channels.fetch(domain.channel).catch(() => { });
      if (channel === undefined) {
        // remove domain
        data.domains.splice(i, 1);

        console.log(
          `[Info]`.padEnd(8),
          `${domain.name} alan adı, artık bir kanala bağlı olmadığı için kaldırıldı.`
        );
      }
    });
  }
}

// check once on start and then in the interval defined in config
setInterval(() => {
  updateDomains();
  verifyData();
}, config.discord.interval * 1000 * 60);
client.once("ready", () => {
  updateDomains();
  verifyData();
});

// save data every 5 minutes
setInterval(
  () =>
    writeFileSync(
      join(__dirname, "..", "data", "data.json"),
      JSON.stringify(data)
    ),
  5 * 60 * 1000
);
