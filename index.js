require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const mongoose = require("mongoose");

// إعداد العميل
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// الإعدادات
const ALLOWED_COMMAND_CHANNEL = "1317668942847807518";
const TOP_CHANNELS = ["1402734934665465978", "1317668942847807518"];
const LOG_CHANNEL = "1391055968334254101";
const OWNER_ID = "1317668426323464243";
const ADMIN_ROLE_ID = "1317668426323464243"; // 👈 رتبة المسؤول

// نموذج المستخدم
const userSchema = new mongoose.Schema({
  userId: String,
  points: { type: Number, default: 0 },
});
const User = mongoose.model("User", userSchema);

// دالة إرسال اللوق بإمبيد
async function sendLog(client, giver, receiver, amount, type) {
  const logChannel = await client.channels.fetch(LOG_CHANNEL).catch(() => null);
  if (!logChannel) return;

  const emoji =
    type === "resetAll"
      ? "🔄"
      : amount > 0
      ? "➕"
      : amount < 0
      ? "➖"
      : "🌀";

  const embed = new EmbedBuilder()
    .setTitle("📋 حدث نقاط")
    .setColor(amount > 0 ? 0x00ff99 : amount < 0 ? 0xff5555 : 0x3498db)
    .addFields(
      { name: "📤 المعطي", value: giver?.toString() || "نظام", inline: true },
      {
        name: "📥 المستفيد",
        value:
          receiver ? receiver.toString() : type === "resetAll" ? "الكل" : "غير محدد",
        inline: true,
      },
      { name: "💰 العدد", value: `${amount}`, inline: true },
      {
        name: "📘 الحدث",
        value:
          type === "add"
            ? "إضافة نقاط"
            : type === "remove"
            ? "حذف نقاط"
            : type === "resetAll"
            ? "تصفير الكل"
            : "تصفير نقاط",
        inline: true,
      }
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed] });
}

// عند تشغيل البوت
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log("🗄️ Connected to MongoDB!");
});

// الأوامر
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const args = msg.content.trim().split(/ +/);
  const command = args.shift();

  // أوامر المسؤول فقط
  if (["نقاط", "حذف", "تصفير"].includes(command)) {
    if (msg.channel.id !== ALLOWED_COMMAND_CHANNEL) return;

    const hasRole = msg.member.roles.cache.has(ADMIN_ROLE_ID);
    const isOwner = msg.author.id === OWNER_ID;

    if (!hasRole && !isOwner) {
      return msg.reply("❌ ما عندك صلاحية تستخدم هذا الأمر!");
    }
  }

  // ===== إعطاء نقاط =====
  if (command === "نقاط") {
    const user = msg.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!user || isNaN(amount))
      return msg.reply("❌ الاستخدام: نقاط @المستخدم <عدد>");
    const data = await User.findOneAndUpdate(
      { userId: user.id },
      { $inc: { points: amount } },
      { new: true, upsert: true }
    );
    msg.reply(
      `✅ تمت إضافة **${amount}** نقاط إلى ${user}. المجموع الآن: **${data.points}**`
    );
    await sendLog(client, msg.author, user, amount, "add");
  }

  // ===== حذف نقاط =====
  if (command === "حذف") {
    const user = msg.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!user || isNaN(amount))
      return msg.reply("❌ الاستخدام: حذف @المستخدم <عدد>");
    const data = await User.findOneAndUpdate(
      { userId: user.id },
      { $inc: { points: -amount } },
      { new: true, upsert: true }
    );
    msg.reply(
      `✅ تم حذف **${amount}** نقاط من ${user}. المجموع الآن: **${data.points}**`
    );
    await sendLog(client, msg.author, user, -amount, "remove");
  }

  // ===== تصفير =====
  if (command === "تصفير") {
    const targetArg = args[0];
    let user = msg.mentions.users.first();

    // السماح باستخدام ID مباشرة
    if (!user && targetArg && /^\d+$/.test(targetArg)) {
      user = await client.users.fetch(targetArg).catch(() => null);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_reset")
        .setLabel("✅ تأكيد")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("cancel_reset")
        .setLabel("❌ إلغاء")
        .setStyle(ButtonStyle.Danger)
    );

    const sent = await msg.reply({
      content: user
        ? `هل أنت متأكد من تصفير نقاط ${user}?`
        : "هل أنت متأكد من تصفير **جميع المستخدمين**؟",
      components: [row],
    });

    const collector = sent.createMessageComponentCollector({
      time: 15000,
      max: 1,
    });

    collector.on("collect", async (interaction) => {
      if (interaction.user.id !== msg.author.id)
        return interaction.reply({
          content: "🚫 هذا الزر مو لك!",
          ephemeral: true,
        });

      if (interaction.customId === "cancel_reset") {
        return interaction.update({
          content: "❌ تم إلغاء العملية.",
          components: [],
        });
      }

      if (interaction.customId === "confirm_reset") {
        if (user) {
          await User.findOneAndUpdate(
            { userId: user.id },
            { points: 0 },
            { upsert: true }
          );

          await interaction.update({
            content: `🌀 تم تصفير نقاط ${user}`,
            components: [],
          });

          await sendLog(client, msg.author, user, 0, "reset");
        } else {
          await User.updateMany({}, { points: 0 });
          await interaction.update({
            content: "🔄 تم تصفير نقاط الجميع!",
            components: [],
          });

          await sendLog(client, msg.author, null, 0, "resetAll");
        }
      }
    });
  }

  // ===== توب =====
  if (command === "توب") {
    if (!TOP_CHANNELS.includes(msg.channel.id)) return;
    const topUsers = await User.find({ points: { $gt: 0 } })
      .sort({ points: -1 })
      .limit(10);

    if (!topUsers.length) return msg.reply("مافي أحد عنده نقاط 😅");

    const list = await Promise.all(
      topUsers.map(async (u, i) => {
        const user = await client.users.fetch(u.userId).catch(() => null);
        return `**${i + 1}.** ${user ? user.toString() : "مستخدم محذوف"} — **${u.points}** 🎯`;
      })
    );

    const embed = new EmbedBuilder()
      .setTitle("🏆 توب نقاط الايفنت")
      .setDescription(list.join("\n"))
      .setColor(0xf1c40f)
      .setTimestamp();

    msg.channel.send({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);
