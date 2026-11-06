
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const verifyToken = require("./authMiddleware");

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing in server/.env");
}

const client = new MongoClient(process.env.MONGODB_URI);

let db;
let booksCollection;
let borrowsCollection;

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BookNook Server is Running!",
    database: db ? "Connected" : "Disconnected",
  });
});

app.get("/health", async (req, res) => {
  try {
    await db.command({ ping: 1 });

    res.status(200).json({
      success: true,
      message: "BookNook API is healthy",
      database: "Connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database connection unavailable",
    });
  }
});

app.get("/books", async (req, res) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const category =
      typeof req.query.category === "string" ? req.query.category.trim() : "";

    const filter = {};

    if (category && category !== "All") {
      filter.category = category;
    }

    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { title: { $regex: safeSearch, $options: "i" } },
        { author: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const books = await booksCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(books);
  } catch (error) {
    console.error("Get books error:", error.message);
    res.status(500).json({ message: "Failed to fetch books" });
  }
});

app.get("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const book = await booksCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    res.status(200).json(book);
  } catch (error) {
    console.error("Get single book error:", error.message);
    res.status(500).json({ message: "Failed to fetch book" });
  }
});

app.post("/books", verifyToken, async (req, res) => {
  try {
    const {
      title,
      author,
      category,
      image,
      description,
      totalCopies,
    } = req.body;

    if (
      ![title, author, category, image, description].every(
        (value) => typeof value === "string" && value.trim()
      ) ||
      !Number.isInteger(totalCopies) ||
      totalCopies < 1
    ) {
      return res.status(400).json({
        message: "Please provide valid book information",
      });
    }

    const newBook = {
      title: title.trim(),
      author: author.trim(),
      category: category.trim(),
      image: image.trim(),
      description: description.trim(),
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      totalCopies,
      availableCopies: totalCopies,
      createdAt: new Date(),
    };

    const result = await booksCollection.insertOne(newBook);

    res.status(201).json({
      message: "Book added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add book error:", error.message);
    res.status(500).json({ message: "Failed to add book" });
  }
});

app.patch("/books/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const {
      title,
      author,
      category,
      image,
      description,
      totalCopies,
    } = req.body;

    if (
      ![title, author, category, image, description].every(
        (value) => typeof value === "string" && value.trim()
      ) ||
      !Number.isInteger(totalCopies) ||
      totalCopies < 1
    ) {
      return res.status(400).json({
        message: "Please provide valid book information",
      });
    }

    const _id = new ObjectId(id);

    const existingBook = await booksCollection.findOne({ _id });

    if (!existingBook) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (existingBook.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    const borrowedCopies =
      existingBook.totalCopies - existingBook.availableCopies;

    if (totalCopies < borrowedCopies) {
      return res.status(400).json({
        message: "Total copies cannot be less than borrowed copies",
      });
    }

    await booksCollection.updateOne(
      { _id, userId: req.user.id },
      {
        $set: {
          title: title.trim(),
          author: author.trim(),
          category: category.trim(),
          image: image.trim(),
          description: description.trim(),
          totalCopies,
          availableCopies: totalCopies - borrowedCopies,
          updatedAt: new Date(),
        },
      }
    );

    res.status(200).json({
      message: "Book updated successfully",
    });
  } catch (error) {
    console.error("Update book error:", error.message);
    res.status(500).json({ message: "Failed to update book" });
  }
});

app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const _id = new ObjectId(id);

    const book = await booksCollection.findOne({
      _id,
      userId: req.user.id,
    });

    if (!book) {
      return res.status(404).json({
        message: "Book not found or access denied",
      });
    }

    const activeBorrows = await borrowsCollection.countDocuments({
      bookId: id,
      status: "borrowed",
    });

    if (activeBorrows > 0) {
      return res.status(409).json({
        message: "Cannot delete a book with active borrows",
      });
    }

    await booksCollection.deleteOne({ _id, userId: req.user.id });

    res.status(200).json({
      message: "Book deleted successfully",
    });
  } catch (error) {
    console.error("Delete book error:", error.message);
    res.status(500).json({ message: "Failed to delete book" });
  }
});

app.post("/borrows", verifyToken, async (req, res) => {
  let reservedBookId = null;

  try {
    const { bookId, returnDate } = req.body;

    if (typeof bookId !== "string" || !ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const parsedReturnDate = new Date(returnDate);

    if (
      !returnDate ||
      Number.isNaN(parsedReturnDate.getTime()) ||
      parsedReturnDate <= new Date()
    ) {
      return res.status(400).json({
        message: "Please provide a valid future return date",
      });
    }

    const existingBorrow = await borrowsCollection.findOne({
      bookId,
      userId: req.user.id,
      status: "borrowed",
    });

    if (existingBorrow) {
      return res.status(409).json({
        message: "You have already borrowed this book",
      });
    }

    const book = await booksCollection.findOneAndUpdate(
      {
        _id: new ObjectId(bookId),
        availableCopies: { $gt: 0 },
      },
      {
        $inc: { availableCopies: -1 },
      },
      { returnDocument: "after" }
    );

    if (!book) {
      return res.status(409).json({
        message: "Book not found or no copies available",
      });
    }

    reservedBookId = book._id;

    const newBorrow = {
      bookId,
      bookTitle: book.title,
      bookImage: book.image,
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      borrowDate: new Date(),
      returnDate: parsedReturnDate,
      status: "borrowed",
      createdAt: new Date(),
    };

    const result = await borrowsCollection.insertOne(newBorrow);

    res.status(201).json({
      message: "Book borrowed successfully",
      borrowId: result.insertedId,
    });
  } catch (error) {
    if (reservedBookId) {
      await booksCollection.updateOne(
        { _id: reservedBookId },
        { $inc: { availableCopies: 1 } }
      );
    }

    if (error.code === 11000) {
      return res.status(409).json({
        message: "You have already borrowed this book",
      });
    }

    console.error("Borrow book error:", error.message);
    res.status(500).json({ message: "Failed to borrow book" });
  }
});

app.get("/borrows", verifyToken, async (req, res) => {
  try {
    const borrows = await borrowsCollection
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(borrows);
  } catch (error) {
    console.error("Get borrows error:", error.message);
    res.status(500).json({ message: "Failed to fetch borrows" });
  }
});

app.delete("/borrows/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid borrow ID" });
    }

    const borrow = await borrowsCollection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        userId: req.user.id,
        status: "borrowed",
      },
      {
        $set: {
          status: "returned",
          returnedAt: new Date(),
        },
      },
      { returnDocument: "before" }
    );

    if (!borrow) {
      return res.status(404).json({
        message: "Active borrow not found",
      });
    }

    await booksCollection.updateOne(
      { _id: new ObjectId(borrow.bookId) },
      { $inc: { availableCopies: 1 } }
    );

    res.status(200).json({
      message: "Book returned successfully",
    });
  } catch (error) {
    console.error("Return book error:", error.message);
    res.status(500).json({ message: "Failed to return book" });
  }
});

async function startServer() {
  try {
    await client.connect();

    console.log("MongoDB Connected Successfully!");

    db = client.db("booknook");

    booksCollection = db.collection("books");
    borrowsCollection = db.collection("borrows");

    app.locals.db = db;

    await borrowsCollection.createIndex(
      { bookId: 1, userId: 1 },
      {
        unique: true,
        partialFilterExpression: { status: "borrowed" },
      }
    );

    await booksCollection.createIndex({ createdAt: -1 });
    await borrowsCollection.createIndex({ userId: 1, createdAt: -1 });

    const port = process.env.PORT || 5000;

    app.listen(port, () => {
      console.log(`BookNook Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
