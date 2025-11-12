const { clientUrl } = require("../config");
const router = require("express").Router();

router.get("/", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.clearCookie("u_tkn", {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      domain: ".shadowclan.cl",
      path: "/",
    });
  } else {
    res.clearCookie("u_tkn", {
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      path: "/",
    });
  }

  res.status(200).send({ redirectUrl: clientUrl + "/login" });
});


module.exports = router;